require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const YooKassa = require('yookassa');
const PDFDocument = require('pdfkit');
const Database = require('./database');
const EmailService = require('./emailService');

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database();
const emailService = new EmailService();

// Инициализация ЮKassa (если заданы ключи)
let yooKassa = null;
if (process.env.YKASSA_SHOP_ID && process.env.YKASSA_SECRET_KEY) {
    yooKassa = new YooKassa({
        shopId: process.env.YKASSA_SHOP_ID,
        secretKey: process.env.YKASSA_SECRET_KEY
    });
    console.log('ЮKassa инициализирована');
} else {
    console.warn('ЮKassa не настроена. Оплата будет недоступна.');
}

// Middleware
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Сессии
app.use(session({
    secret: 'tulip-festival-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Middleware для проверки аутентификации
const requireAuth = (req, res, next) => {
    if (req.session.user) {
        next();
    } else {
        res.status(401).json({ error: 'Требуется авторизация' });
    }
};

// Middleware для проверки прав администратора
const requireAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Доступ запрещен. Требуются права администратора' });
    }
};

// Middleware для проверки прав менеджера или администратора
const requireManager = (req, res, next) => {
    if (req.session.user && (req.session.user.role === 'manager' || req.session.user.role === 'admin')) {
        next();
    } else {
        res.status(403).json({ error: 'Доступ запрещен. Требуются права менеджера или администратора' });
    }
};

// Статические страницы
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/events', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'events.html'));
});

app.get('/booking', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'booking.html'));
});

app.get('/admin', requireManager, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/my-bookings', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'my-bookings.html'));
});

// Страница возврата после оплаты (отправляет запрос на подтверждение)
app.get('/payment-result', (req, res) => {
    const bookingCode = req.query.booking || '';
    res.send(`
        <html>
        <head><title>Оплата выполнена</title></head>
        <body>
            <p>Подтверждение платежа...</p>
            <script>
                fetch('/api/confirm-payment?bookingCode=${bookingCode}')
                    .then(r => r.json())
                    .then(data => {
                        if (data.success) alert('Билеты оплачены! Чек отправлен на почту.');
                        else alert('Ошибка: ' + (data.error || 'неизвестно'));
                    })
                    .catch(() => alert('Ошибка связи с сервером'))
                    .finally(() => window.close());
            </script>
        </body>
        </html>
    `);
});

// ==================== АУТЕНТИФИКАЦИЯ ====================
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }

    db.verifyUser(username, password, (err, user) => {
        if (err) {
            console.error('Ошибка аутентификации:', err);
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        if (!user) {
            return res.status(401).json({ error: 'Неверные учетные данные' });
        }

        req.session.user = {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role
        };

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                role: user.role
            }
        });
    });
});

app.post('/api/register', (req, res) => {
    const { username, email, password, confirmPassword } = req.body;

    if (!username || !email || !password || !confirmPassword) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }

    if (password !== confirmPassword) {
        return res.status(400).json({ error: 'Пароли не совпадают' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
    }

    db.createUser({
        username,
        email,
        password,
        role: 'user'
    }, (err, user) => {
        if (err) {
            console.error('Ошибка регистрации:', err);
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ error: 'Пользователь с таким именем или email уже существует' });
            }
            return res.status(500).json({ error: 'Ошибка создания пользователя' });
        }

        res.json({
            success: true,
            message: 'Пользователь успешно создан'
        });
    });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Ошибка выхода:', err);
            return res.status(500).json({ error: 'Ошибка выхода' });
        }
        res.json({ success: true });
    });
});

app.get('/api/user', (req, res) => {
    if (req.session.user) {
        res.json({ user: req.session.user });
    } else {
        res.json({ user: null });
    }
});

// ==================== ПУБЛИЧНЫЕ API ====================
app.get('/api/events', (req, res) => {
    db.getAllEvents((err, events) => {
        if (err) {
            console.error('Ошибка получения мероприятий:', err);
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        res.json(events);
    });
});

app.get('/api/events/:id', (req, res) => {
    const eventId = req.params.id;
    db.getEventById(eventId, (err, event) => {
        if (err) {
            console.error('Ошибка получения мероприятия:', err);
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        if (!event) {
            return res.status(404).json({ error: 'Мероприятие не найдено' });
        }
        res.json(event);
    });
});

// Создание бронирования (без отправки чека, только создание pending брони)
app.post('/api/booking', (req, res) => {
    const { name, email, phone, tickets, eventId } = req.body;
    const userId = req.session.user ? req.session.user.id : null;

    if (!name || !email || !tickets || !eventId) {
        return res.status(400).json({ error: 'Заполните все обязательные поля' });
    }

    db.createVisitor({ name, email, phone }, (err, visitor) => {
        if (err) {
            console.error('Ошибка создания посетителя:', err);
            return res.status(500).json({ error: 'Ошибка создания бронирования' });
        }

        db.getEventById(eventId, (err, event) => {
            if (err || !event) {
                return res.status(404).json({ error: 'Мероприятие не найдено' });
            }

            if (event.available_tickets < tickets) {
                return res.status(400).json({ error: 'Недостаточно доступных билетов' });
            }

            const total_price = event.price * tickets;

            db.createBooking({
                visitor_id: visitor.id,
                event_id: eventId,
                user_id: userId,
                ticket_count: parseInt(tickets),
                total_price: total_price
            }, (err, booking) => {
                if (err) {
                    console.error('Ошибка создания бронирования:', err);
                    return res.status(500).json({ error: 'Ошибка создания бронирования' });
                }

                // Отправляем ответ пользователю
                res.json({
                    success: true,
                    bookingId: booking.booking_code,
                    message: 'Бронирование создано. Перейдите к оплате.'
                });

                // Отправляем подтверждение бронирования на email (асинхронно)
                emailService.sendBookingConfirmation(booking, event, visitor)
                    .then(result => {
                        if (!result.success) console.error('Ошибка отправки подтверждения:', result.error);
                    })
                    .catch(err => console.error('Исключение при отправке подтверждения:', err));
            });
        });
    });
});

// ==================== ОПЛАТА И QR-КОДЫ ====================
// Создание платежа в ЮKassa
app.post('/api/create-payment', requireAuth, async (req, res) => {
    if (!yooKassa) {
        return res.status(503).json({ error: 'Платёжная система не настроена' });
    }

    const { bookingCode } = req.body;
    if (!bookingCode) {
        return res.status(400).json({ error: 'Не указан код бронирования' });
    }

    db.getBookingByCode(bookingCode, async (err, booking) => {
        if (err || !booking) {
            return res.status(404).json({ error: 'Бронирование не найдено' });
        }
        if (booking.status !== 'pending') {
            return res.status(400).json({ error: 'Бронирование уже оплачено или отменено' });
        }
        if (booking.user_id !== req.session.user.id && req.session.user.role !== 'admin') {
            return res.status(403).json({ error: 'Нет прав на оплату этого бронирования' });
        }

        const idempotenceKey = uuidv4();
        try {
            const payment = await yooKassa.createPayment({
                amount: {
                    value: booking.total_price,
                    currency: 'RUB'
                },
                capture: true,
                payment_method_data: {
                    type: 'bank_card'
                },
                confirmation: {
                    type: 'redirect',
                    return_url: `http://localhost:${PORT}/payment-result?booking=${bookingCode}`
                },
                description: `Бронирование ${bookingCode} - ${booking.event_title}`
            }, idempotenceKey);

            // Сохраняем payment_id в брони
            db.updateBookingStatus(bookingCode, 'pending', payment.id, (err) => {
                if (err) console.error('Ошибка сохранения payment_id:', err);
            });

            res.json({ confirmationUrl: payment.confirmation.confirmation_url });
        } catch (error) {
            console.error('Ошибка создания платежа:', error);
            res.status(500).json({ error: 'Ошибка создания платежа' });
        }
    });
});

// Подтверждение оплаты после возврата с платёжной страницы
app.get('/api/confirm-payment', requireAuth, async (req, res) => {
    const { bookingCode } = req.query;
    if (!bookingCode) {
        return res.status(400).json({ error: 'Не указан код бронирования' });
    }

    db.getBookingByCode(bookingCode, async (err, booking) => {
        if (err || !booking) {
            return res.status(404).json({ error: 'Бронирование не найдено' });
        }
        if (booking.status === 'paid') {
            return res.json({ success: true, message: 'Бронирование уже оплачено' });
        }
        if (booking.status !== 'pending') {
            return res.status(400).json({ error: 'Некорректный статус бронирования' });
        }
        if (!booking.payment_id) {
            return res.status(400).json({ error: 'Информация о платеже отсутствует' });
        }

        try {
            const paymentInfo = await yooKassa.getPayment(booking.payment_id);
            if (paymentInfo.status === 'succeeded') {
                // Обновляем статус брони
                db.updateBookingStatus(bookingCode, 'paid', null, async (err) => {
                    if (err) {
                        console.error('Ошибка обновления статуса:', err);
                        return res.status(500).json({ error: 'Ошибка обновления статуса' });
                    }
                    // Генерируем QR и отправляем чек
                    try {
                        const qrDataUrl = await QRCode.toDataURL(bookingCode);
                        await emailService.sendPaidReceipt(booking, qrDataUrl);
                        console.log(`Чек с QR-кодом отправлен на ${booking.visitor_email}`);
                    } catch (emailErr) {
                        console.error('Ошибка отправки чека:', emailErr);
                    }
                    res.json({ success: true, message: 'Оплата подтверждена' });
                });
            } else {
                res.status(400).json({ error: `Платёж не завершён, статус: ${paymentInfo.status}` });
            }
        } catch (error) {
            console.error('Ошибка проверки платежа:', error);
            res.status(500).json({ error: 'Ошибка проверки платежа' });
        }
    });
});

// Вебхук для уведомлений от ЮKassa (резервный канал)
app.post('/api/webhook/yookassa', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!yooKassa) {
        return res.sendStatus(200);
    }

    let event;
    try {
        event = JSON.parse(req.body.toString());
    } catch (err) {
        console.error('Ошибка парсинга вебхука:', err);
        return res.sendStatus(400);
    }

    if (event.object && event.object.status === 'succeeded') {
        const paymentId = event.object.id;
        db.db.get("SELECT booking_code FROM bookings WHERE payment_id = ?", [paymentId], async (err, row) => {
            if (err || !row) return res.sendStatus(200);
            db.updateBookingStatus(row.booking_code, 'paid', null, async (err) => {
                if (err) console.error(err);
                else {
                    db.getBookingByCode(row.booking_code, async (err, booking) => {
                        if (err || !booking) return;
                        try {
                            const qrDataUrl = await QRCode.toDataURL(booking.booking_code);
                            await emailService.sendPaidReceipt(booking, qrDataUrl);
                            console.log(`Чек с QR-кодом отправлен на ${booking.visitor_email} (вебхук)`);
                        } catch (emailErr) {
                            console.error('Ошибка отправки чека:', emailErr);
                        }
                    });
                }
            });
        });
    }
    res.sendStatus(200);
});

// Получение QR-кода для бронирования
app.get('/api/qr/:bookingCode', requireAuth, async (req, res) => {
    const { bookingCode } = req.params;
    db.getBookingByCode(bookingCode, async (err, booking) => {
        if (err || !booking) {
            return res.status(404).json({ error: 'Бронирование не найдено' });
        }
        if (booking.user_id !== req.session.user.id && req.session.user.role !== 'admin') {
            return res.status(403).json({ error: 'Нет доступа к этому бронированию' });
        }
        if (booking.status !== 'paid') {
            return res.status(400).json({ error: 'QR-код доступен только для оплаченных бронирований' });
        }
        try {
            const qrDataUrl = await QRCode.toDataURL(bookingCode);
            res.json({ qrUrl: qrDataUrl });
        } catch (err) {
            console.error('Ошибка генерации QR:', err);
            res.status(500).json({ error: 'Ошибка генерации QR-кода' });
        }
    });
});

// ==================== СКАЧИВАНИЕ БИЛЕТА В PDF ====================
app.get('/api/download-ticket/:bookingCode', requireAuth, async (req, res) => {
    const { bookingCode } = req.params;

    db.getBookingByCode(bookingCode, async (err, booking) => {
        if (err || !booking) {
            return res.status(404).json({ error: 'Бронирование не найдено' });
        }
        if (booking.user_id !== req.session.user.id && req.session.user.role !== 'admin') {
            return res.status(403).json({ error: 'Нет доступа к этому бронированию' });
        }
        if (booking.status !== 'paid') {
            return res.status(400).json({ error: 'Билет доступен только после оплаты' });
        }

        try {
            const qrBuffer = await QRCode.toBuffer(bookingCode, { type: 'png', margin: 1, width: 200 });
            const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 50 });

            // Регистрируем шрифт с поддержкой кириллицы
            const fontPath = path.join(__dirname, 'fonts', 'DejaVuSans.ttf');
            doc.registerFont('DejaVuSans', fontPath);
            doc.font('DejaVuSans');

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=ticket_${bookingCode}.pdf`);
            doc.pipe(res);

            // Заголовок
            doc.fontSize(24).fillColor('#e91e63').text('Фестиваль Тюльпанов', { align: 'center' });
            doc.moveDown(0.5);
            doc.fontSize(18).fillColor('#333').text('Электронный билет', { align: 'center' });
            doc.moveDown(1);

            // Информация о мероприятии
            doc.fontSize(14).fillColor('#000');
            doc.text(`Мероприятие: ${booking.event_title}`, { underline: true });
            doc.moveDown(0.5);
            doc.text(`Дата и время: ${booking.event_date} в ${booking.event_time}`);
            doc.text(`Количество билетов: ${booking.ticket_count}`);
            doc.text(`Общая стоимость: ${booking.total_price} руб.`);
            doc.text(`Код бронирования: ${booking.booking_code}`);
            doc.moveDown(1);

            // QR-код
            doc.image(qrBuffer, { fit: [150, 150], align: 'center' });
            doc.moveDown(0.5);
            doc.fontSize(10).fillColor('#666').text('Предъявите этот QR-код на входе', { align: 'center' });
            doc.moveDown(1);

            // Дополнительная информация
            doc.fontSize(10).fillColor('#999');
            doc.text('Билет действителен только при предъявлении оригинала документа, удостоверяющего личность.', { align: 'center' });
            doc.text('Пожалуйста, сохраняйте билет до окончания мероприятия.', { align: 'center' });

            doc.end();
        } catch (error) {
            console.error('Ошибка генерации PDF:', error);
            res.status(500).json({ error: 'Ошибка генерации билета' });
        }
    });
});

// ==================== УПРАВЛЕНИЕ БРОНИРОВАНИЯМИ (ОТМЕНА) ====================
app.delete('/api/bookings/:bookingCode', requireAuth, (req, res) => {
    const { bookingCode } = req.params;
    db.getBookingByCode(bookingCode, (err, booking) => {
        if (err || !booking) {
            return res.status(404).json({ error: 'Бронирование не найдено' });
        }
        if (booking.user_id !== req.session.user.id && req.session.user.role !== 'admin') {
            return res.status(403).json({ error: 'Нет прав на отмену этого бронирования' });
        }
        if (booking.status === 'paid') {
            return res.status(400).json({ error: 'Оплаченное бронирование нельзя отменить через API. Обратитесь к администратору.' });
        }
        db.cancelBooking(bookingCode, (err) => {
            if (err) {
                console.error('Ошибка отмены бронирования:', err);
                return res.status(500).json({ error: 'Ошибка отмены' });
            }
            res.json({ success: true, message: 'Бронирование отменено, билеты возвращены' });
        });
    });
});

// ==================== API ДЛЯ МЕНЕДЖЕРА/АДМИНА ====================
app.get('/api/bookings', requireManager, (req, res) => {
    db.getAllBookings((err, bookings) => {
        if (err) {
            console.error('Ошибка получения бронирований:', err);
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        res.json(bookings);
    });
});

app.post('/api/events', requireManager, (req, res) => {
    console.log('Данные мероприятия:', req.body);
    
    const { title, description, full_description, date, time, price, type, image, capacity } = req.body;

    if (!title || !date || !time || !price || !type || !description || !full_description) {
        console.log('Отсутствуют обязательные поля');
        return res.status(400).json({ error: 'Заполните все обязательные поля' });
    }

    db.createEvent(req.body, function (err) {
        if (err) {
            console.error('Ошибка создания мероприятия:', err);
            return res.status(500).json({ error: 'Ошибка создания мероприятия' });
        }
        res.json({ success: true, message: 'Мероприятие создано' });
    });
});

app.delete('/api/events/:id', requireManager, (req, res) => {
    const eventId = req.params.id;

    db.deleteEvent(eventId, function (err) {
        if (err) {
            console.error('Ошибка удаления мероприятия:', err);
            return res.status(500).json({ error: 'Ошибка удаления мероприятия' });
        }
        res.json({ success: true, message: 'Мероприятие удалено' });
    });
});

app.put('/api/events/:id', requireManager, (req, res) => {
    const eventId = req.params.id;
    const { title, description, full_description, date, time, price, type, image, capacity, available_tickets } = req.body;

    if (!title || !date || !time || !price || !type || !description || !full_description) {
        return res.status(400).json({ error: 'Заполните все обязательные поля' });
    }

    db.updateEvent(eventId, req.body, function (err) {
        if (err) {
            console.error('Ошибка обновления мероприятия:', err);
            return res.status(500).json({ error: 'Ошибка обновления мероприятия' });
        }
        res.json({ success: true, message: 'Мероприятие обновлено' });
    });
});

// Повторная отправка чека (для администратора)
app.post('/api/resend-receipt', requireManager, async (req, res) => {
    const { bookingCode } = req.body;
    if (!bookingCode) {
        return res.status(400).json({ error: 'Укажите номер бронирования' });
    }

    db.getBookingByCode(bookingCode, async (err, booking) => {
        if (err || !booking) {
            return res.status(404).json({ error: 'Бронирование не найдено' });
        }
        if (booking.status !== 'paid') {
            return res.status(400).json({ error: 'Чек можно отправить только для оплаченных бронирований' });
        }
        try {
            const qrDataUrl = await QRCode.toDataURL(booking.booking_code);
            await emailService.sendPaidReceipt(booking, qrDataUrl);
            res.json({ success: true, message: 'Чек успешно отправлен на почту' });
        } catch (err) {
            console.error('Ошибка отправки чека:', err);
            res.status(500).json({ error: 'Ошибка при отправке письма' });
        }
    });
});

// API для получения бронирований пользователя
app.get('/api/my-bookings', requireAuth, (req, res) => {
    const userId = req.session.user.id;

    db.getAllBookingsForUser(userId, (err, bookings) => {
        if (err) {
            console.error('Ошибка получения бронирований:', err);
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        res.json(bookings);
    });
});

// ==================== УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ (только администратор) ====================
app.get('/api/users', requireAdmin, (req, res) => {
    db.getAllUsers((err, users) => {
        if (err) {
            console.error('Ошибка получения пользователей:', err);
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        res.json(users);
    });
});

app.put('/api/users/:id/role', requireAdmin, (req, res) => {
    const userId = req.params.id;
    const { role } = req.body;

    if (!role || !['user', 'manager', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'Недопустимая роль' });
    }

    if (req.session.user.id == userId) {
        return res.status(403).json({ error: 'Нельзя изменить свою роль' });
    }

    if (role !== 'admin') {
        db.countAdmins((err, row) => {
            if (err) return res.status(500).json({ error: 'Ошибка сервера' });
            if (row.count === 1) {
                db.getUserById(userId, (err, user) => {
                    if (err || !user) return res.status(404).json({ error: 'Пользователь не найден' });
                    if (user.role === 'admin') {
                        return res.status(400).json({ error: 'Нельзя изменить роль единственного администратора' });
                    }
                    proceedUpdate();
                });
            } else {
                proceedUpdate();
            }
        });
    } else {
        proceedUpdate();
    }

    function proceedUpdate() {
        db.updateUserRole(userId, role, (err, result) => {
            if (err) {
                console.error('Ошибка обновления роли:', err);
                return res.status(500).json({ error: 'Ошибка сервера' });
            }
            if (result.changes === 0) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }
            res.json({ success: true, message: 'Роль обновлена' });
        });
    }
});

// Получение бронирований пользователя (для администратора)
app.get('/api/admin/users/:userId/bookings', requireAdmin, (req, res) => {
    const userId = req.params.userId;
    db.getAllBookingsForUser(userId, (err, bookings) => {
        if (err) {
            console.error('Ошибка получения бронирований пользователя:', err);
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        res.json(bookings);
    });
});

// ==================== ПОЛУЧЕНИЕ БРОНИРОВАНИЙ ПО МЕРОПРИЯТИЮ (только администратор) ====================
app.get('/api/admin/events/:eventId/bookings', requireAdmin, (req, res) => {
    const eventId = req.params.eventId;
    const sql = `
        SELECT 
            b.id, b.ticket_count, b.total_price, b.status, b.booking_code, b.created_at,
            v.name as visitor_name, v.email as visitor_email, v.phone as visitor_phone,
            u.username as user_name
        FROM bookings b
        JOIN visitors v ON b.visitor_id = v.id
        LEFT JOIN users u ON b.user_id = u.id
        WHERE b.event_id = ?
        ORDER BY b.created_at DESC
    `;
    db.db.all(sql, [eventId], (err, rows) => {
        if (err) {
            console.error('Ошибка получения бронирований мероприятия:', err);
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        res.json(rows);
    });
});

// ==================== ОТЧЁТЫ И СТАТИСТИКА (только администратор) ====================
app.get('/api/stats/sales-by-event', requireAdmin, (req, res) => {
    db.getSalesByEvent((err, rows) => {
        if (err) {
            console.error('Ошибка получения статистики продаж:', err);
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        res.json(rows);
    });
});

app.get('/api/stats/revenue', requireAdmin, (req, res) => {
    const { start, end } = req.query;
    db.getRevenueByPeriod(start, end, (err, row) => {
        if (err) {
            console.error('Ошибка получения выручки за период:', err);
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        res.json(row);
    });
});

app.get('/api/stats/popularity-by-type', requireAdmin, (req, res) => {
    db.getPopularityByType((err, rows) => {
        if (err) {
            console.error('Ошибка получения популярности типов:', err);
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        res.json(rows);
    });
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
    console.log('\nЗавершение работы сервера...');
    db.close();
    process.exit(0);
});