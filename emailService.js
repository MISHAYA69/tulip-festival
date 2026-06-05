const nodemailer = require('nodemailer');

class EmailService {
    constructor() {
        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: process.env.SMTP_PORT || 587,
            secure: false,
            auth: {
                user: process.env.SMTP_USER || 'mishayashlaev@gmail.com',
                pass: process.env.SMTP_PASS || 'rllx wbee shmi ygts'
            }
        });
    }

    // Метод для отправки подтверждения бронирования (используется для уведомления о создании брони, без QR)
    async sendBookingConfirmation(bookingDetails, event, visitor) {
        try {
            const mailOptions = {
                from: process.env.SMTP_USER || 'tulip-festival@example.com',
                to: visitor.email,
                subject: `Подтверждение бронирования - ${event.title}`,
                html: this.generateBookingEmail(bookingDetails, event, visitor)
            };

            await this.transporter.sendMail(mailOptions);
            return { success: true };
        } catch (error) {
            console.error('Ошибка отправки email:', error);
            return { success: false, error: error.message };
        }
    }

    // Метод для отправки финального чека с QR-кодом после успешной оплаты
    async sendPaidReceipt(bookingDetails, qrDataUrl) {
        try {
            const mailOptions = {
                from: process.env.SMTP_USER || 'tulip-festival@example.com',
                to: bookingDetails.visitor_email,
                subject: `Ваши билеты на мероприятие "${bookingDetails.event_title}"`,
                html: this.generatePaidEmail(bookingDetails, qrDataUrl)
            };

            await this.transporter.sendMail(mailOptions);
            console.log(`Финальный чек с QR-кодом отправлен на ${bookingDetails.visitor_email}`);
            return { success: true };
        } catch (error) {
            console.error('Ошибка отправки финального чека:', error);
            return { success: false, error: error.message };
        }
    }

    generateBookingEmail(bookingDetails, event, visitor) {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: #4CAF50; color: white; padding: 20px; text-align: center; }
                    .content { background: #f9f9f9; padding: 20px; }
                    .booking-info { background: white; padding: 15px; margin: 10px 0; border-left: 4px solid #4CAF50; }
                    .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Фестиваль Тюльпанов</h1>
                        <h2>Подтверждение бронирования</h2>
                    </div>
                    <div class="content">
                        <p>Уважаемый(ая) ${visitor.name},</p>
                        <p>Ваше бронирование успешно создано! Для завершения необходимо оплатить заказ.</p>
                        
                        <div class="booking-info">
                            <h3>Детали бронирования:</h3>
                            <p><strong>Код бронирования:</strong> ${bookingDetails.booking_code}</p>
                            <p><strong>Мероприятие:</strong> ${event.title}</p>
                            <p><strong>Дата и время:</strong> ${event.date} в ${event.time}</p>
                            <p><strong>Количество билетов:</strong> ${bookingDetails.ticket_count}</p>
                            <p><strong>Общая стоимость:</strong> ${bookingDetails.total_price} руб.</p>
                        </div>

                        <p><strong>Описание мероприятия:</strong><br>${event.description}</p>
                        
                        <p>После оплаты вы получите электронные билеты с QR-кодом.</p>
                        <p>С уважением,<br>Команда Фестиваля Тюльпанов</p>
                    </div>
                    <div class="footer">
                        <p>Это письмо сгенерировано автоматически. Пожалуйста, не отвечайте на него.</p>
                    </div>
                </div>
            </body>
            </html>
        `;
    }

    generatePaidEmail(bookingDetails, qrDataUrl) {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: #4CAF50; color: white; padding: 20px; text-align: center; }
                    .content { background: #f9f9f9; padding: 20px; }
                    .booking-info { background: white; padding: 15px; margin: 10px 0; border-left: 4px solid #4CAF50; }
                    .qr-code { text-align: center; margin: 20px 0; }
                    .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Фестиваль Тюльпанов</h1>
                        <h2>Ваши билеты</h2>
                    </div>
                    <div class="content">
                        <p>Уважаемый(ая) ${bookingDetails.visitor_name},</p>
                        <p>Оплата прошла успешно! Ваши билеты прилагаются.</p>
                        
                        <div class="booking-info">
                            <h3>Детали билетов:</h3>
                            <p><strong>Код бронирования:</strong> ${bookingDetails.booking_code}</p>
                            <p><strong>Мероприятие:</strong> ${bookingDetails.event_title}</p>
                            <p><strong>Дата и время:</strong> ${bookingDetails.event_date} в ${bookingDetails.event_time}</p>
                            <p><strong>Количество билетов:</strong> ${bookingDetails.ticket_count}</p>
                            <p><strong>Общая стоимость:</strong> ${bookingDetails.total_price} руб.</p>
                        </div>

                        <div class="qr-code">
                            <p><strong>Ваш QR-код для входа:</strong></p>
                            <img src="${qrDataUrl}" alt="QR-код билета" style="width:200px;height:200px; border:1px solid #ddd; border-radius:10px;">
                            <p>Покажите этот QR-код на входе (можно распечатать или показать на экране телефона).</p>
                        </div>

                        <p>С уважением,<br>Команда Фестиваля Тюльпанов</p>
                    </div>
                    <div class="footer">
                        <p>Это письмо сгенерировано автоматически. Пожалуйста, не отвечайте на него.</p>
                    </div>
                </div>
            </body>
            </html>
        `;
    }
}

module.exports = EmailService;