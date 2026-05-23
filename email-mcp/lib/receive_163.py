# -*- coding: utf-8 -*-
# @Time    : 2022/11/9 17:11
# @Author  : Cocktail_py

import os
import email
import imaplib
import quopri
import re
from email.header import decode_header
from bs4 import BeautifulSoup

# 服务器自动匹配工具
from email_config import get_imap_server
FILE_SAVE_PATH = r''


def save_file(file_name, data, save_path=''):
    file_path = os.path.join(save_path, file_name)
    with open(file_path, 'wb') as fp:
        fp.write(data)
    return file_path


class Message(dict):
    """邮件内容存储格式"""


class Email(object):
    # 邮件类型
    All, Unseen, Seen, Recent, Answered, Flagged = "All,Unseen,Seen,Recent,Answered,Flagged".split(',')

    def __init__(self, imap, account, password, file_save_path=''):
        if imap and account and password:
            self.host = imap
            self.account = account
            self.password = password
            self.save_path = file_save_path
            self.imap_server = self.login()

    def login(self):
        imap_server = imaplib.IMAP4_SSL(self.host)
        imap_server.login(self.account, self.password)
        # 解决网易邮箱报错：Unsafe Login. Please contact kefu@188.com for help
        imaplib.Commands["ID"] = ('AUTH',)
        args = ("name", self.account, "contact", self.account, "version", "1.0.0", "vendor", "myclient")
        imap_server._simple_command("ID", str(args).replace(",", "").replace("\'", "\""))
        return imap_server

    def get_newest(self):
        """获取最新的未读邮件,自动下载附件"""
        for msg_data in self.check_email(message_type=self.Unseen):
            print("\n" + "="*50)
            print(f"发件人：{msg_data.get('from', '未知')}")
            print(f"邮件主题：{msg_data.get('subject', '无主题')}")
            print(f"邮件日期：{msg_data.get('date', '未知')}")
            
            # 显示附件列表
            files = msg_data.get('files', [])
            if files:
                print(f"附件列表（{len(files)}个）：")
                for i, file in enumerate(files, 1):
                    print(f"  {i}. {file}")
            else:
                print("附件列表：无附件")
                
            # 显示邮件正文
            content = msg_data.get('content', '')
            if content:
                print("\n邮件正文：")
                print("-"*30)
                # 如果内容太长，只显示前500个字符
                if len(content) > 500:
                    print(content[:500] + "...(内容已截断)")
                else:
                    print(content)
                print("-"*30)
            else:
                print("\n邮件正文：无内容")
                
            print("="*50 + "\n")
            return msg_data

    def check_email(self, last_message=True, message_type="Unseen", count=1):
        """Message status in "All,Unseen,Seen,Recent,Answered,Flagged"
        :param last_message: 返回邮箱最新(最后一封)邮件,默认为True,
        :param message_type: 检索邮件类型,默认为Unseen(未读)邮件,
        :param count: 检出的邮件消息数目 默认为 1
        :return:
        """
        # 选中收件箱
        select_status, info = self.imap_server.select(mailbox='INBOX')
        if select_status != 'OK':
            print(info)
            raise StopIteration
        # 选择邮件类型
        search_status, items = self.imap_server.search(None, message_type)
        if select_status != 'OK':
            print(items)
            raise StopIteration
        message_list = items[0].split()[-1:] if last_message else items[0].split()[:count]
        print("Read messages within the last 30 days,total {0} {1}type message, read {2}".format(len(items[0].split()),
                                                                                                 message_type,
                                                                                                 len(message_list)))
        for message_index in message_list:
            msg_data = Message()
            fetch_status, message = self.imap_server.fetch(message_index, "(RFC822)")
            msg = email.message_from_bytes(message[0][1])

            # 消息日期
            msg_data['date'] = msg['Date']
            # 消息主题
            msg_data['subject'] = self.decode_mime_header(msg["Subject"])
            # 消息正文,消息类型,消息附件
            msg_data.update(self.parse_message(msg, save_path=self.save_path))
            yield msg_data

    @staticmethod
    def str_to_unicode(s, encoding=None):
        """将字符串转换为Unicode格式"""
        return str(s, encoding) if encoding else str(s)
        
    @staticmethod
    def decode_mime_header(header):
        """解码MIME格式的邮件头，如Subject和附件名"""
        if not header:
            return ""
            
        # 处理发件人信息，格式通常为："Name" <email@example.com> 或 =?utf-8?B?xxxx?= <email@example.com>
        if isinstance(header, str) and '<' in header and '>' in header:
            # 提取名称部分和邮箱部分
            name_match = re.match(r'([^<]*)<([^>]+)>', header)
            if name_match:
                name_part = name_match.group(1).strip()
                email_part = name_match.group(2).strip()
                
                # 解码名称部分
                if name_part.startswith('=?') or name_part.startswith('"=?'):
                    # 移除多余的引号
                    if name_part.startswith('"') and name_part.endswith('"'):
                        name_part = name_part[1:-1]
                    
                    # 解码名称
                    decoded_parts = []
                    for part, encoding in decode_header(name_part):
                        if isinstance(part, bytes):
                            decoded_parts.append(part.decode(encoding or 'utf-8', errors='replace'))
                        else:
                            decoded_parts.append(part)
                    decoded_name = ''.join(decoded_parts)
                    
                    # 返回格式化的发件人信息
                    return f"{decoded_name} <{email_part}>"
                else:
                    # 名称已经是可读的
                    return header
        
        # 处理普通的MIME编码头部
        try:
            # 如果已经是字符串且不包含编码标记，直接返回
            if isinstance(header, str) and not header.startswith('=?'):
                return header
                
            # 对于形如 =?utf-8?B?xxxx?= 的格式进行解码
            if isinstance(header, str) and header.startswith('=?'):
                decoded_parts = []
                for part, encoding in decode_header(header):
                    if isinstance(part, bytes):
                        decoded_parts.append(part.decode(encoding or 'utf-8', errors='replace'))
                    else:
                        decoded_parts.append(part)
                return ''.join(decoded_parts)
            # 对于bytes类型直接解码
            elif isinstance(header, bytes):
                return header.decode('utf-8', errors='replace')
            else:
                return str(header)
        except Exception as e:
            print(f"解码头部时出错: {e}")
            return str(header)

    @staticmethod
    def clean_html_content(html_content):
        """清理HTML内容，移除不必要的标签和信息"""
        if not html_content:
            return ""
            
        try:
            # 使用BeautifulSoup清理HTML
            soup = BeautifulSoup(html_content, 'html.parser')
            
            # 移除所有脚本和样式标签
            for script in soup(["script", "style"]):
                script.extract()
                
            # 移除所有链接和图片
            for tag in soup.find_all(['a', 'img']):
                # 保留链接的文本内容
                if tag.name == 'a' and tag.string:
                    tag.replace_with(tag.string)
                else:
                    tag.extract()
                    
            # 获取文本内容
            text = soup.get_text(separator='\n', strip=True)
            
            # 清理多余的空行
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            text = '\n'.join(lines)
            
            return text
        except Exception as e:
            print(f"清理HTML内容时出错: {e}")
            # 如果解析失败，尝试移除所有HTML标签
            return re.sub(r'<[^>]+>', '', html_content)
    
    @staticmethod
    def parse_message(msg, save_path=''):
        """解析message并下载附件，返回字典类型"""
        plain_content = None
        html_content = None
        files = []
        
        # 获取邮件发件人
        from_info = msg.get('From', '')
        
        for part in msg.walk():
            if not part.is_multipart():
                content_type = part.get_content_type()
                filename = part.get_filename()
                
                # 处理附件
                if filename:
                    # 解码附件文件名
                    decoded_filename = Email.decode_mime_header(filename)
                    data = part.get_payload(decode=True)
                    print(f'附件: {decoded_filename}')
                    
                    # 保存附件
                    if decoded_filename:
                        save_file(decoded_filename, data, save_path)
                        files.append(decoded_filename)
                
                # 处理邮件正文
                elif content_type == 'text/plain':
                    charset = part.get_content_charset() or 'utf-8'
                    try:
                        payload = part.get_payload(decode=True)
                        if payload:
                            plain_content = payload.decode(charset, errors='replace')
                    except Exception as e:
                        print(f"解析纯文本内容出错: {e}")
                
                elif content_type == 'text/html':
                    charset = part.get_content_charset() or 'utf-8'
                    try:
                        payload = part.get_payload(decode=True)
                        if payload:
                            html_content = payload.decode(charset, errors='replace')
                    except Exception as e:
                        print(f"解析HTML内容出错: {e}")
        
        # 优先使用纯文本内容，如果没有则使用清理后的HTML内容
        content = plain_content
        if not content and html_content:
            content = Email.clean_html_content(html_content)
        
        msg_data = {
            'from': Email.decode_mime_header(from_info),
            'content': content,
            'files': files
        }
        return msg_data


def decode_MIME():
    """MIME字符进行解码"""
    text = """=E5=9B=A0=E4=B8=BA=E4=B8=81=E4=BF=8A=E6=99=96=E5=8F=AA=E8=B7=9F=E7=9D=80= =E9=BA=A6=E8=BF=AA=E5=B0=B1=E4=B8=8D=E5=8F=AF=E8=83=BD=E9=82=A3=E5=88=B0= =E6=80=BB=E5=86=A0=E5=86=9B=E6=88=92=E6=8C=87=EF=BC=8C=E8=80=83=E8=99=91= =E5=88=B0=E6=8A=A4=E7=90=83=E9=97=AE=E9=A2=98=EF=BC=8C=E5=A6=82=E6=9E=9C= =E7=94=A8=E9=BA=A6=E8=BF=AA=E6=8D=A2=E4=BA=A8=E5=88=A9=E7=9A=84=E8=AF=9D= =E8=AF=B4=E4=B8=8D=E5=AE=9A=E5=B0=B1=E8=A1=8C=EF=BC=8C=E5=BD=93=E7=84=B6= =E8=AF=B8=E8=91=9B=E5=AD=94=E6=98=8E=E8=BF=99=E4=B8=AA=E8=80=81=E7=8B=90= =E7=8B=B8=E8=82=AF=E5=AE=9A=E6=98=AF=E7=95=A5=E6=87=82=E8=BF=99=E4=BB=B6= =E4=BA=8B=E7=9A=84=EF=BC=8C=E4=BB=96=E7=AC=AC=E4=B8=80=E4=B8=AA=E4=B8=8D= =E7=AD=94=E5=BA=94=EF=BC=8C=E5=B0=B1=E7=AE=97=E4=BB=96=E7=AD=94=E5=BA=94= =E4=BA=86=EF=BC=8C=E7=BC=9D=E5=B0=8F=E8=82=9B=E8=83=BD=E7=AD=94=E5=BA=94= =E5=90=97=EF=BC=9F=E6=89=80=E4=BB=A5=E8=BF=99=E6=95=B4=E4=BB=B6=E4=BA=8B= =E6=83=85=E7=9A=84=E4=BA=AE=E7=82=B9=E5=B0=B1=E5=9C=A8=E4=BA=8E=E7=A7=A6= =E5=A5=8B"""
    result = quopri.decodestring(text).decode("u8")
    print(result)


if __name__ == '__main__':
    # 示例：请传入实际的账号与授权码；服务器将自动匹配
    demo_account = os.environ.get('DEMO_EMAIL_ACCOUNT', '')
    demo_password = os.environ.get('DEMO_EMAIL_PASSWORD', '')
    email_163 = Email(imap=get_imap_server(demo_account), account=demo_account, password=demo_password, file_save_path=FILE_SAVE_PATH)
    print(email_163.get_newest())

