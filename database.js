const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

class Database {
    constructor() {
        // Определяем путь к файлу базы данных:
        // - На Amvera (при наличии смонтированной папки /data) используем /data/festival.db
        // - Локально – создаём файл в текущей директории
        const dbPath = process.env.AMVERA_MOUNT_PATH 
            ? path.join(process.env.AMVERA_MOUNT_PATH, 'festival.db')
            : './festival.db';
        
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('Ошибка подключения к БД:', err.message);
            } else {
                console.log(`Подключение к SQLite базе данных установлено (${dbPath})`);
                this.initDatabase();
            }
        });
    }
    
    initDatabase() {
        const tables = [
            `CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT DEFAULT 'user',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                full_description TEXT,
                date TEXT NOT NULL,
                time TEXT NOT NULL,
                price INTEGER NOT NULL,
                type TEXT NOT NULL,
                image TEXT,
                capacity INTEGER DEFAULT 20,
                available_tickets INTEGER DEFAULT 20,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS visitors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                phone TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS bookings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                visitor_id INTEGER,
                event_id INTEGER,
                user_id INTEGER,
                ticket_count INTEGER NOT NULL,
                total_price INTEGER NOT NULL,
                status TEXT DEFAULT 'pending',
                payment_id TEXT,
                booking_code TEXT UNIQUE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (visitor_id) REFERENCES visitors (id),
                FOREIGN KEY (event_id) REFERENCES events (id),
                FOREIGN KEY (user_id) REFERENCES users (id)
            )`
        ];
    
        tables.forEach((sql, index) => {
            this.db.run(sql, (err) => {
                if (err) {
                    console.error(`Ошибка создания таблицы ${index + 1}:`, err);
                } else {
                    console.log(`Таблица ${index + 1} создана/проверена`);
                }
            });
        });
    
        // Добавляем колонку payment_id, если её нет (миграция)
        this.db.run(`ALTER TABLE bookings ADD COLUMN payment_id TEXT`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Ошибка добавления payment_id:', err);
            }
        });

        // Миграция: существующие брони со статусом 'confirmed' меняем на 'paid'
        this.db.run(`UPDATE bookings SET status = 'paid' WHERE status = 'confirmed'`, (err) => {
            if (err) console.error('Миграция статусов не удалась', err);
            else console.log('Старые бронирования помечены как оплаченные');
        });
    
        this.seedData();
    }
    
    seedData() {
        // Проверяем, есть ли уже данные
        this.db.get("SELECT COUNT(*) as count FROM events", (err, row) => {
            if (err) return;
    
            if (row.count === 0) {
                const events = [
                    {
                        title: "Экскурсия по тюльпановым полям",
                        description: "Прогулка по цветущим полям с профессиональным гидом",
                        full_description: "Приглашаем вас на увлекательную экскурсию по самым красивым тюльпановым полям нашего региона. Вы увидите более 50 сортов тюльпанов, узнаете историю их выращивания и секреты ухода. Наш опытный гид расскажет о символике цветов и проведет вас по самым живописным маршрутам. Продолжительность экскурсии - 2 часа. Рекомендуем удобную обувь и фотоаппарат для создания незабываемых снимков.",
                        date: "2024-04-15",
                        time: "10:00",
                        price: 500,
                        type: "excursion",
                        image: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80",
                        capacity: 25,
                        available_tickets: 25
                    },
                    {
                        title: "Мастер-класс по флористике",
                        description: "Научитесь создавать красивые букеты из тюльпанов",
                        full_description: "Под руководством профессионального флориста вы научитесь создавать элегантные букеты и композиции из тюльпанов. Мы предоставим все необходимые материалы: свежие тюльпаны различных сортов и цветов, декоративную зелень, упаковочные материалы и инструменты. Вы узнаете о принципах композиции, сочетании цветов и техниках продления жизни срезанных цветов. Каждый участник уйдет с собственным творением и сертификатом об участии. Идеально для начинающих и любителей флористики.",
                        date: "2024-04-16",
                        time: "14:00",
                        price: 1000,
                        type: "master",
                        image: "https://images.unsplash.com/photo-1487070183333-13a0d6dff0dc?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80",
                        capacity: 15,
                        available_tickets: 15
                    },
                    {
                        title: "Фотосессия в тюльпанах",
                        description: "Профессиональная фотосессия среди цветущих тюльпанов",
                        full_description: "Запечатлейте самые яркие моменты среди моря цветущих тюльпанов! Наш профессиональный фотограф с многолетним опытом создаст для вас неповторимые снимки в лучших локациях фестиваля. Мы предлагаем индивидуальные, парные и семейные фотосессии. В стоимость включено: 1 час съемки, 10 обработанных фотографий в электронном виде, рекомендации по образам и позам. Дополнительно можно заказать печать фотографий и полный архив съемки. Идеальная возможность сохранить память о фестивале на долгие годы.",
                        date: "2024-04-17",
                        time: "16:00",
                        price: 800,
                        type: "photo",
                        image: "https://images.unsplash.com/photo-1520763185298-1b434c919102?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80",
                        capacity: 10,
                        available_tickets: 10
                    },
                    {
                        title: "Концерт классической музыки",
                        description: "Вечер классической музыки в саду тюльпанов",
                        full_description: "Погрузитесь в мир прекрасной музыки среди благоухающих тюльпанов! В программе концерта: произведения Чайковского, Вивальди, Моцарта и Шопена в исполнении струнного квартета 'Флора'. Концерт проходит в открытом амфитеатре с акустической системой премиум-класса. Продолжительность - 1,5 часа с антрактом. Во время антракта гостей ждет фуршет с освежающими напитками и легкими закусками. Рекомендуем взять с собой пледы для большего комфорта. Незабываемый вечер для ценителей классики и природы.",
                        date: "2024-04-18",
                        time: "19:00",
                        price: 1200,
                        type: "concert",
                        image: "https://images.unsplash.com/photo-1507838153414-b4b713384a76?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80",
                        capacity: 50,
                        available_tickets: 50
                    }
                ];
    
                const stmt = this.db.prepare(`INSERT INTO events 
                    (title, description, full_description, date, time, price, type, image, capacity, available_tickets) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    
                events.forEach(event => {
                    stmt.run([
                        event.title, 
                        event.description, 
                        event.full_description,
                        event.date, 
                        event.time,
                        event.price, 
                        event.type, 
                        event.image, 
                        event.capacity, 
                        event.available_tickets
                    ]);
                });
    
                stmt.finalize();
                console.log('Тестовые мероприятия добавлены в базу данных');
            }
        });
    
        // Создаем администратора по умолчанию
        this.createUser({
            username: 'admin',
            email: 'admin@tulipfest.ru',
            password: 'admin123',
            role: 'admin'
        }, (err, user) => {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    console.log('Администратор уже существует');
                } else {
                    console.error('Ошибка создания администратора:', err);
                }
            } else {
                console.log('Администратор создан:', user.username);
            }
        });
        
        // Создаем тестового менеджера (для удобства)
        this.createUser({
            username: 'manager',
            email: 'manager@tulipfest.ru',
            password: 'manager123',
            role: 'manager'
        }, (err, user) => {
            if (err) {
                if (!err.message.includes('UNIQUE constraint failed')) {
                    console.error('Ошибка создания менеджера:', err);
                }
            } else {
                console.log('Тестовый менеджер создан:', user.username);
            }
        });
    }

    // Методы для работы с пользователями
    createUser(userData, callback = () => { }) {
        const { username, email, password, role } = userData;

        bcrypt.hash(password, 10, (err, hashedPassword) => {
            if (err) {
                callback(err);
                return;
            }

            const sql = `INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)`;
            this.db.run(sql, [username, email, hashedPassword, role || 'user'], function (err) {
                if (err) {
                    callback(err);
                } else {
                    callback(null, {
                        id: this.lastID,
                        username,
                        email,
                        role: role || 'user'  
                    });
                }
            });
        });
    }

    getUserByUsername(username, callback) {
        this.db.get("SELECT * FROM users WHERE username = ?", [username], callback);
    }

    getUserByEmail(email, callback) {
        this.db.get("SELECT * FROM users WHERE email = ?", [email], callback);
    }

    verifyUser(username, password, callback) {
        this.getUserByUsername(username, (err, user) => {
            if (err) return callback(err);
            if (!user) return callback(null, false);

            bcrypt.compare(password, user.password, (err, result) => {
                if (err) return callback(err);
                callback(null, result ? user : false);
            });
        });
    }

    // Методы для работы с мероприятиями
    getAllEvents(callback) {
        this.db.all("SELECT * FROM events ORDER BY date, time", callback);
    }

    getEventById(id, callback) {
        this.db.get("SELECT * FROM events WHERE id = ?", [id], callback);
    }

    createEvent(eventData, callback) {
        const { title, description, full_description, date, time, price, type, image, capacity } = eventData;
        const sql = `INSERT INTO events 
            (title, description, full_description, date, time, price, type, image, capacity, available_tickets) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        this.db.run(sql, [
            title, description, full_description, date, time, price, type, image,
            capacity || 20, capacity || 20
        ], callback);
    }

    updateEvent(id, eventData, callback) {
        const { 
            title, description, full_description, date, time, price, type, image, 
            capacity, available_tickets 
        } = eventData;

        let newAvailable = (available_tickets !== undefined) ? available_tickets : capacity;
        if (newAvailable > capacity) newAvailable = capacity;
        if (newAvailable < 0) newAvailable = 0;

        const sql = `UPDATE events SET 
            title = ?, description = ?, full_description = ?, date = ?, time = ?, price = ?, 
            type = ?, image = ?, capacity = ?, available_tickets = ?
            WHERE id = ?`;

        this.db.run(sql, [
            title, description, full_description, date, time, price, type, image,
            capacity, newAvailable, id
        ], callback);
    }

    deleteEvent(id, callback) {
        this.db.run("DELETE FROM events WHERE id = ?", [id], callback);
    }

    // Методы для работы с посетителями
    createVisitor(visitorData, callback) {
        const { name, email, phone } = visitorData;

        this.getVisitorByEmail(email, (err, existingVisitor) => {
            if (err) return callback(err);

            if (existingVisitor) {
                const sql = `UPDATE visitors SET name = ?, phone = ? WHERE email = ?`;
                this.db.run(sql, [name, phone, email], function (err) {
                    if (err) return callback(err);
                    callback(null, { ...existingVisitor, name, phone });
                });
            } else {
                const sql = `INSERT INTO visitors (name, email, phone) VALUES (?, ?, ?)`;
                this.db.run(sql, [name, email, phone], function (err) {
                    if (err) return callback(err);
                    callback(null, { id: this.lastID, name, email, phone });
                });
            }
        });
    }

    getVisitorByEmail(email, callback) {
        this.db.get("SELECT * FROM visitors WHERE email = ?", [email], callback);
    }

    // Методы для работы с бронированиями
    createBooking(bookingData, callback) {
        const { visitor_id, event_id, user_id, ticket_count, total_price } = bookingData;

        this.getEventById(event_id, (err, event) => {
            if (err) return callback(err);
            if (!event) return callback(new Error('Мероприятие не найдено'));
            if (event.available_tickets < ticket_count) {
                return callback(new Error(`Недостаточно билетов. Доступно: ${event.available_tickets}`));
            }

            const booking_code = 'BK' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();

            const sql = `INSERT INTO bookings 
            (visitor_id, event_id, user_id, ticket_count, total_price, booking_code, status) 
            VALUES (?, ?, ?, ?, ?, ?, 'pending')`;

            this.db.run(sql, [visitor_id, event_id, user_id, ticket_count, total_price, booking_code], function (err) {
                if (err) {
                    callback(err);
                } else {
                    this.db.run(
                        "UPDATE events SET available_tickets = available_tickets - ? WHERE id = ?",
                        [ticket_count, event_id],
                        function (updateErr) {
                            if (updateErr) {
                                callback(updateErr);
                            } else {
                                callback(null, {
                                    id: this.lastID,
                                    booking_code,
                                    visitor_id,
                                    event_id,
                                    user_id,
                                    ticket_count,
                                    total_price
                                });
                            }
                        }.bind(this)
                    );
                }
            }.bind(this));
        });
    }

    getAllBookings(callback) {
        const sql = `
            SELECT 
                b.*,
                v.name as visitor_name,
                v.email as visitor_email,
                v.phone as visitor_phone,
                e.title as event_title,
                e.date as event_date,
                e.time as event_time
            FROM bookings b
            JOIN visitors v ON b.visitor_id = v.id
            JOIN events e ON b.event_id = e.id
            ORDER BY b.created_at DESC
        `;
        this.db.all(sql, callback);
    }

    getBookingByCode(booking_code, callback) {
        const sql = `
            SELECT 
                b.*,
                v.name as visitor_name,
                v.email as visitor_email,
                v.phone as visitor_phone,
                e.title as event_title,
                e.date as event_date,
                e.time as event_time,
                e.price as event_price,
                e.description as event_description
            FROM bookings b
            JOIN visitors v ON b.visitor_id = v.id
            JOIN events e ON b.event_id = e.id
            WHERE b.booking_code = ?
        `;
        this.db.get(sql, [booking_code], callback);
    }

    getBookingDetails(bookingId, callback) {
        const sql = `
            SELECT 
                b.*,
                v.name as visitor_name,
                v.email as visitor_email,
                v.phone as visitor_phone,
                e.title as event_title,
                e.date as event_date,
                e.time as event_time,
                e.price as event_price,
                e.description as event_description
            FROM bookings b
            JOIN visitors v ON b.visitor_id = v.id
            JOIN events e ON b.event_id = e.id
            WHERE b.booking_code = ? OR b.id = ?
        `;
        this.db.get(sql, [bookingId, bookingId], callback);
    }

    getAllBookingsForUser(userId, callback) {
        // Исключаем отменённые бронирования, чтобы они не отображались пользователю
        const sql = `
            SELECT 
                b.*,
                v.name as visitor_name,
                v.email as visitor_email,
                v.phone as visitor_phone,
                e.title as event_title,
                e.date as event_date,
                e.time as event_time,
                e.price as event_price
            FROM bookings b
            JOIN visitors v ON b.visitor_id = v.id
            JOIN events e ON b.event_id = e.id
            WHERE b.user_id = ? AND b.status != 'cancelled'
            ORDER BY b.created_at DESC
        `;
        this.db.all(sql, [userId], callback);
    }

    // Новые методы для статусов и оплаты
    updateBookingStatus(bookingCode, status, paymentId = null, callback) {
        let sql = `UPDATE bookings SET status = ? WHERE booking_code = ?`;
        let params = [status, bookingCode];
        if (paymentId) {
            sql = `UPDATE bookings SET status = ?, payment_id = ? WHERE booking_code = ?`;
            params = [status, paymentId, bookingCode];
        }
        this.db.run(sql, params, callback);
    }

    cancelBooking(bookingCode, callback) {
        // Сначала получаем данные брони, чтобы вернуть билеты
        this.getBookingByCode(bookingCode, (err, booking) => {
            if (err || !booking) return callback(err || new Error('Бронирование не найдено'));
            if (booking.status === 'cancelled') return callback(new Error('Бронирование уже отменено'));
            if (booking.status === 'paid') {
                // Для оплаченных броней нужно предусмотреть возврат денег (здесь только возврат билетов)
                // В реальном проекте нужен вызов API платёжной системы
                // Пока просто возвращаем билеты и меняем статус
            }
            // Обновляем статус
            this.db.run("UPDATE bookings SET status = 'cancelled' WHERE booking_code = ?", [bookingCode], (err) => {
                if (err) return callback(err);
                // Возвращаем билеты
                this.db.run(
                    "UPDATE events SET available_tickets = available_tickets + ? WHERE id = ?",
                    [booking.ticket_count, booking.event_id],
                    callback
                );
            });
        });
    }

    // ==================== МЕТОДЫ ДЛЯ ОТЧЁТОВ ====================
    getSalesByEvent(callback) {
        const sql = `
            SELECT 
                e.id,
                e.title,
                COUNT(b.id) as tickets_sold,
                SUM(b.total_price) as revenue
            FROM events e
            LEFT JOIN bookings b ON e.id = b.event_id
            GROUP BY e.id
            ORDER BY tickets_sold DESC
        `;
        this.db.all(sql, callback);
    }

    getRevenueByPeriod(startDate, endDate, callback) {
        let sql = `
            SELECT 
                SUM(total_price) as total_revenue,
                COUNT(*) as total_bookings
            FROM bookings
        `;
        const params = [];
        if (startDate && endDate) {
            sql += ` WHERE created_at BETWEEN ? AND ?`;
            params.push(startDate, endDate);
        }
        this.db.get(sql, params, callback);
    }

    getPopularityByType(callback) {
        const sql = `
            SELECT 
                e.type,
                COUNT(b.id) as bookings_count,
                SUM(b.total_price) as revenue
            FROM events e
            LEFT JOIN bookings b ON e.id = b.event_id
            GROUP BY e.type
            ORDER BY bookings_count DESC
        `;
        this.db.all(sql, callback);
    }

    getStats(callback) {
        const stats = {};

        this.db.get("SELECT COUNT(*) as total_events FROM events", (err, row) => {
            if (err) return callback(err);
            stats.total_events = row.total_events;

            this.db.get("SELECT COUNT(*) as total_bookings FROM bookings", (err, row) => {
                if (err) return callback(err);
                stats.total_bookings = row.total_bookings;

                this.db.get("SELECT SUM(total_price) as total_revenue FROM bookings", (err, row) => {
                    if (err) return callback(err);
                    stats.total_revenue = row.total_revenue || 0;

                    this.db.get("SELECT COUNT(*) as total_visitors FROM visitors", (err, row) => {
                        if (err) return callback(err);
                        stats.total_visitors = row.total_visitors;
                        callback(null, stats);
                    });
                });
            });
        });
    }

    // ==================== УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ ====================
    getAllUsers(callback) {
        const sql = "SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC";
        this.db.all(sql, callback);
    }

    getUserById(id, callback) {
        const sql = "SELECT id, username, email, role, created_at FROM users WHERE id = ?";
        this.db.get(sql, [id], callback);
    }

    updateUserRole(userId, newRole, callback) {
        const sql = "UPDATE users SET role = ? WHERE id = ?";
        this.db.run(sql, [newRole, userId], function(err) {
            callback(err, { changes: this.changes });
        });
    }

    countAdmins(callback) {
        const sql = "SELECT COUNT(*) as count FROM users WHERE role = 'admin'";
        this.db.get(sql, callback);
    }

    close() {
        this.db.close((err) => {
            if (err) {
                console.error('Ошибка закрытия БД:', err.message);
            } else {
                console.log('Подключение к БД закрыто');
            }
        });
    }
}

module.exports = Database;