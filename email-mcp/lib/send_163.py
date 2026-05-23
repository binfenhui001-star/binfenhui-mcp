# -*- coding: utf-8 -*-
# @Time    : 2024
# @Author  : Cocktail_py

import smtplib
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
from email.header import Header

from email_config import get_smtp_server  # 自动匹配SMTP服务器

class EmailSender:
    """163邮箱发送邮件类"""
    
    def __init__(self, account, password, smtp_server=None):
        """
        初始化邮件发送器
        
        Args:
            account (str): 邮箱账号
            password (str): 邮箱密码或授权码
            smtp_server (str, optional): SMTP服务器地址；若不提供，将依据账号自动匹配
        """
        if not account or not password:
            raise ValueError("account 和 password 为必填参数")
        self.account = account
        self.password = password
        self.smtp_server = smtp_server or get_smtp_server(account)
        
    def send_text_email(self, to_addr, subject, content, cc_addr=None):
        """
        发送纯文本邮件
        
        Args:
            to_addr (str or list): 收件人邮箱地址，可以是单个字符串或字符串列表
            subject (str): 邮件主题
            content (str): 邮件正文内容
            cc_addr (str or list, optional): 抄送人邮箱地址，可以是单个字符串或字符串列表
            
        Returns:
            dict: 包含发送状态和消息的字典
        """
        try:
            # 创建邮件对象
            msg = MIMEMultipart()
            msg['From'] = self.account
            
            # 处理收件人
            if isinstance(to_addr, list):
                msg['To'] = ','.join(to_addr)
            else:
                msg['To'] = to_addr
                
            # 处理抄送人
            if cc_addr:
                if isinstance(cc_addr, list):
                    msg['Cc'] = ','.join(cc_addr)
                else:
                    msg['Cc'] = cc_addr
            
            # 设置邮件主题和内容
            msg['Subject'] = Header(subject, 'utf-8')
            msg.attach(MIMEText(content, 'plain', 'utf-8'))
            
            # 获取所有收件人列表
            recipients = []
            if isinstance(to_addr, list):
                recipients.extend(to_addr)
            else:
                recipients.append(to_addr)
                
            if cc_addr:
                if isinstance(cc_addr, list):
                    recipients.extend(cc_addr)
                else:
                    recipients.append(cc_addr)
            
            # 发送邮件
            server = smtplib.SMTP_SSL(self.smtp_server, 465)
            server.login(self.account, self.password)
            server.sendmail(self.account, recipients, msg.as_string())
            server.quit()
            
            return {"status": "success", "message": f"邮件已成功发送给 {msg['To']}"}
            
        except Exception as e:
            return {"status": "error", "message": f"发送邮件失败: {str(e)}"}
    
    def send_html_email(self, to_addr, subject, html_content, cc_addr=None):
        """
        发送HTML格式邮件
        
        Args:
            to_addr (str or list): 收件人邮箱地址，可以是单个字符串或字符串列表
            subject (str): 邮件主题
            html_content (str): HTML格式的邮件正文内容
            cc_addr (str or list, optional): 抄送人邮箱地址，可以是单个字符串或字符串列表
            
        Returns:
            dict: 包含发送状态和消息的字典
        """
        try:
            # 创建邮件对象
            msg = MIMEMultipart()
            msg['From'] = self.account
            
            # 处理收件人
            if isinstance(to_addr, list):
                msg['To'] = ','.join(to_addr)
            else:
                msg['To'] = to_addr
                
            # 处理抄送人
            if cc_addr:
                if isinstance(cc_addr, list):
                    msg['Cc'] = ','.join(cc_addr)
                else:
                    msg['Cc'] = cc_addr
            
            # 设置邮件主题和内容
            msg['Subject'] = Header(subject, 'utf-8')
            msg.attach(MIMEText(html_content, 'html', 'utf-8'))
            
            # 获取所有收件人列表
            recipients = []
            if isinstance(to_addr, list):
                recipients.extend(to_addr)
            else:
                recipients.append(to_addr)
                
            if cc_addr:
                if isinstance(cc_addr, list):
                    recipients.extend(cc_addr)
                else:
                    recipients.append(cc_addr)
            
            # 发送邮件
            server = smtplib.SMTP_SSL(self.smtp_server, 465)
            server.login(self.account, self.password)
            server.sendmail(self.account, recipients, msg.as_string())
            server.quit()
            
            return {"status": "success", "message": f"HTML邮件已成功发送给 {msg['To']}"}
            
        except Exception as e:
            return {"status": "error", "message": f"发送HTML邮件失败: {str(e)}"}
    
    def send_email_with_attachment(self, to_addr, subject, content, attachment_paths, cc_addr=None, is_html=False):
        """
        发送带附件的邮件
        
        Args:
            to_addr (str or list): 收件人邮箱地址，可以是单个字符串或字符串列表
            subject (str): 邮件主题
            content (str): 邮件正文内容
            attachment_paths (str or list): 附件路径，可以是单个字符串或字符串列表
            cc_addr (str or list, optional): 抄送人邮箱地址，可以是单个字符串或字符串列表
            is_html (bool, optional): 内容是否为HTML格式，默认为False
            
        Returns:
            dict: 包含发送状态和消息的字典
        """
        try:
            # 创建邮件对象
            msg = MIMEMultipart()
            msg['From'] = self.account
            
            # 处理收件人
            if isinstance(to_addr, list):
                msg['To'] = ','.join(to_addr)
            else:
                msg['To'] = to_addr
                
            # 处理抄送人
            if cc_addr:
                if isinstance(cc_addr, list):
                    msg['Cc'] = ','.join(cc_addr)
                else:
                    msg['Cc'] = cc_addr
            
            # 设置邮件主题和内容
            msg['Subject'] = Header(subject, 'utf-8')
            
            # 添加邮件正文
            content_type = 'html' if is_html else 'plain'
            msg.attach(MIMEText(content, content_type, 'utf-8'))
            
            # 添加附件
            if attachment_paths:
                if not isinstance(attachment_paths, list):
                    attachment_paths = [attachment_paths]
                
                for attachment_path in attachment_paths:
                    if os.path.isfile(attachment_path):
                        with open(attachment_path, 'rb') as f:
                            attachment = MIMEApplication(f.read())
                            attachment_name = os.path.basename(attachment_path)
                            attachment.add_header('Content-Disposition', 'attachment', filename=attachment_name)
                            msg.attach(attachment)
            
            # 获取所有收件人列表
            recipients = []
            if isinstance(to_addr, list):
                recipients.extend(to_addr)
            else:
                recipients.append(to_addr)
                
            if cc_addr:
                if isinstance(cc_addr, list):
                    recipients.extend(cc_addr)
                else:
                    recipients.append(cc_addr)
            
            # 发送邮件
            server = smtplib.SMTP_SSL(self.smtp_server, 465)
            server.login(self.account, self.password)
            server.sendmail(self.account, recipients, msg.as_string())
            server.quit()
            
            return {"status": "success", "message": f"带附件的邮件已成功发送给 {msg['To']}"}
            
        except Exception as e:
            return {"status": "error", "message": f"发送带附件的邮件失败: {str(e)}"}


# 测试代码
if __name__ == '__main__':
    sender = EmailSender()
    result = sender.send_text_email(
        to_addr='example@example.com',
        subject='测试邮件',
        content='这是一封测试邮件'
    )
    print(result)