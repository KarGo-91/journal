import os
import random
import smtplib
import sys
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587

PROMPTS = [
    "What was the highlight of your day today, and why did it stand out?",
    "Describe a moment today when you felt peaceful or fully present.",
    "What is one thing you accomplished today that you are proud of?",
    "If you could rewrite one interaction or event from today, how would you change it?",
    "What is something you learned today about yourself or someone else?",
    "Who made you smile or feel appreciated today? Write them a quick mental thank-you note.",
    "What did you spend the most energy on today? Was it worth it?",
    "What is currently occupying your mind that you need to let go of tonight?",
    "Describe one small beauty you noticed today (a sound, a sight, a taste).",
    "What are you feeling most grateful for at this exact moment?",
    "Did you face any obstacles today? How did you respond to them?",
    "How did you take care of your physical or mental well-being today?",
    "What is a goal or intention you want to set for yourself tomorrow?",
    "Write about a book, quote, or thought that inspired you today.",
    "If today was a chapter in a book, what would the chapter title be?",
    "What is something you are looking forward to in the coming days?",
    "How were you kind to yourself or to someone else today?",
    "What is one thing that felt heavy today? Let's write it down to release it.",
    "Describe today's weather and how it influenced your mood.",
    "What advice would you give to yourself starting tomorrow morning?"
]

def send_email(subject, html_body, receiver):
    sender = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    
    if not sender or not password:
        print("Error: SMTP_USER or SMTP_PASSWORD environment variables are not set.")
        return False
        
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"Ambitious Journal <{sender}>"
    msg["To"] = receiver
    
    part_html = MIMEText(html_body, "html")
    msg.attach(part_html)
    
    try:
        server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
        server.starttls()
        server.login(sender, password)
        server.sendmail(sender, receiver, msg.as_string())
        server.quit()
        print("Reminder email sent successfully!")
        return True
    except Exception as e:
        print(f"Error sending email: {e}")
        return False

def main():
    receiver = os.getenv("RECEIVER_EMAIL")
    if not receiver:
        print("Error: RECEIVER_EMAIL is not set in environment variables.")
        sys.exit(1)
        
    journal_url = os.getenv("JOURNAL_URL", "https://KarGo-91.github.io/journal/")
    prompt = random.choice(PROMPTS)
    
    subject = "✍️ Time to reflect: Your daily journal reminder"
    
    html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Daily Journal Reminder</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0;">
        <!-- Header banner -->
        <tr>
            <td style="background: linear-gradient(135deg, #10b981 0%, #8b5cf6 100%); padding: 40px 30px; text-align: center;">
                <h1 style="margin: 0; font-family: Georgia, serif; font-size: 26px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">Ambitious</h1>
                <p style="margin: 5px 0 0 0; font-size: 14px; color: rgba(255, 255, 255, 0.85); font-weight: 500;">Your daily space for reflection</p>
            </td>
        </tr>
        
        <!-- Content body -->
        <tr>
            <td style="padding: 40px 30px;">
                <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #334155; font-weight: 500;">
                    Hello, friend. As your day comes to a close, take five minutes to step back, breathe, and reflect.
                </p>
                
                <!-- Prompt Card -->
                <div style="background-color: #f1f5f9; border-left: 4px solid #10b981; border-radius: 6px; padding: 20px; margin-bottom: 30px;">
                    <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #10b981; letter-spacing: 1px; display: block; margin-bottom: 8px;">Nightly Prompt</span>
                    <p style="margin: 0; font-family: Georgia, serif; font-size: 18px; font-style: italic; line-height: 1.6; color: #1e293b;">
                        "{prompt}"
                    </p>
                </div>
                
                <!-- CTA Button -->
                <div style="text-align: center; margin-bottom: 20px;">
                    <a href="{journal_url}" target="_blank" style="background: linear-gradient(135deg, #10b981 0%, #8b5cf6 100%); color: #ffffff; padding: 14px 30px; font-size: 15px; font-weight: 700; text-decoration: none; border-radius: 8px; display: inline-block; box-shadow: 0 4px 10px rgba(16, 185, 129, 0.2); text-transform: uppercase; letter-spacing: 0.5px;">Write in your Diary ✍️</a>
                </div>
            </td>
        </tr>
        
        <!-- Footer -->
        <tr>
            <td style="background-color: #f8fafc; padding: 25px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.5;">
                    This is an automated reflection reminder from your personal journaling hub.<br>
                    May your evening be peaceful and restful. 🌙😴
                </p>
            </td>
        </tr>
    </table>
</body>
</html>
"""
    
    send_email(subject, html_body, receiver)

if __name__ == "__main__":
    main()
