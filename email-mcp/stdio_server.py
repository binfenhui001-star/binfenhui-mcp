#!/usr/bin/env python3
"""
缤纷汇内置 email-mcp（stdio）。
基于 https://github.com/RickyQzh/email_mcp ，支持多账号 account_id。
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, List, Optional, Union

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "lib"))

from mcp.server.fastmcp import FastMCP

from accounts import AccountStore
from email_config import get_imap_server, get_smtp_server
from receive_163 import Email
from send_163 import EmailSender

mcp = FastMCP("email-mcp")


def _resolve(
    account_id: Optional[str],
    account: Optional[str],
    password: Optional[str],
    imap_server: Optional[str],
    smtp_server: Optional[str],
) -> tuple[str, str, Optional[str], Optional[str]]:
    if account and password:
        return (
            account.strip(),
            password,
            imap_server.strip() if imap_server else None,
            smtp_server.strip() if smtp_server else None,
        )
    store = AccountStore.load()
    cred = store.resolve(account_id)
    return (
        cred.account,
        cred.password,
        imap_server.strip() if imap_server else cred.imap_server,
        smtp_server.strip() if smtp_server else cred.smtp_server,
    )


@mcp.tool()
def email_list_accounts() -> dict[str, Any]:
    """列出已配置的邮箱账号（不含密码）。多账号时其它工具需传 account_id。"""
    store = AccountStore.load()
    return {
        "accounts": store.list_public(),
        "default_account_id": store.default_id,
        "config_path": store.config_path() or None,
    }


@mcp.tool()
def get_newest_email(
    account_id: Optional[str] = None,
    account: Optional[str] = None,
    password: Optional[str] = None,
    imap_server: Optional[str] = None,
) -> dict[str, Any]:
    """获取最新一封未读邮件（发件人、主题、正文、附件列表）。"""
    email_addr, pwd, imap_override, _ = _resolve(
        account_id, account, password, imap_server, None
    )
    client = Email(
        imap=imap_override or get_imap_server(email_addr),
        account=email_addr,
        password=pwd,
    )
    msg_data = client.get_newest()
    return {
        "account_id": account_id,
        "from": msg_data.get("from", "未知"),
        "subject": msg_data.get("subject", "无主题"),
        "date": msg_data.get("date", "未知"),
        "content": msg_data.get("content", ""),
        "files": msg_data.get("files", []),
    }


@mcp.tool()
def check_emails(
    account_id: Optional[str] = None,
    message_type: str = "Unseen",
    count: int = 5,
    account: Optional[str] = None,
    password: Optional[str] = None,
    imap_server: Optional[str] = None,
) -> List[dict[str, Any]]:
    """检查指定类型与数量的邮件。message_type: All, Unseen, Seen, Recent, Answered, Flagged。"""
    email_addr, pwd, imap_override, _ = _resolve(
        account_id, account, password, imap_server, None
    )
    client = Email(
        imap=imap_override or get_imap_server(email_addr),
        account=email_addr,
        password=pwd,
    )
    messages: list[dict[str, Any]] = []
    for msg_data in client.check_email(
        last_message=False, message_type=message_type, count=count
    ):
        messages.append(
            {
                "from": msg_data.get("from", "未知"),
                "subject": msg_data.get("subject", "无主题"),
                "date": msg_data.get("date", "未知"),
                "content": msg_data.get("content", ""),
                "files": msg_data.get("files", []),
            }
        )
    return messages


@mcp.tool()
def save_attachment(
    file_name: str,
    account_id: Optional[str] = None,
    save_path: str = "",
    account: Optional[str] = None,
    password: Optional[str] = None,
    imap_server: Optional[str] = None,
) -> str:
    """保存最新未读邮件中的指定附件到 save_path（默认当前目录）。"""
    import os

    email_addr, pwd, imap_override, _ = _resolve(
        account_id, account, password, imap_server, None
    )
    client = Email(
        imap=imap_override or get_imap_server(email_addr),
        account=email_addr,
        password=pwd,
        file_save_path=save_path,
    )
    msg_data = client.get_newest()
    files = msg_data.get("files", [])
    if file_name not in files:
        return f"未找到名为 {file_name} 的附件"
    file_path = os.path.join(save_path, file_name)
    if os.path.exists(file_path):
        return f"文件已保存到 {file_path}"
    return "文件保存失败"


@mcp.tool()
def send_text_email(
    to_addr: Union[str, List[str]],
    subject: str,
    content: str,
    account_id: Optional[str] = None,
    cc_addr: Union[str, List[str], None] = None,
    account: Optional[str] = None,
    password: Optional[str] = None,
    smtp_server: Optional[str] = None,
) -> dict[str, str]:
    """发送纯文本邮件。"""
    email_addr, pwd, _, smtp_override = _resolve(
        account_id, account, password, None, smtp_server
    )
    sender = EmailSender(
        account=email_addr,
        password=pwd,
        smtp_server=smtp_override or get_smtp_server(email_addr),
    )
    return sender.send_text_email(to_addr, subject, content, cc_addr)


@mcp.tool()
def send_html_email(
    to_addr: Union[str, List[str]],
    subject: str,
    html_content: str,
    account_id: Optional[str] = None,
    cc_addr: Union[str, List[str], None] = None,
    account: Optional[str] = None,
    password: Optional[str] = None,
    smtp_server: Optional[str] = None,
) -> dict[str, str]:
    """发送 HTML 邮件。"""
    email_addr, pwd, _, smtp_override = _resolve(
        account_id, account, password, None, smtp_server
    )
    sender = EmailSender(
        account=email_addr,
        password=pwd,
        smtp_server=smtp_override or get_smtp_server(email_addr),
    )
    return sender.send_html_email(to_addr, subject, html_content, cc_addr)


@mcp.tool()
def send_email_with_attachment(
    to_addr: Union[str, List[str]],
    subject: str,
    content: str,
    attachment_paths: Union[str, List[str]],
    account_id: Optional[str] = None,
    cc_addr: Union[str, List[str], None] = None,
    is_html: bool = False,
    account: Optional[str] = None,
    password: Optional[str] = None,
    smtp_server: Optional[str] = None,
) -> dict[str, str]:
    """发送带附件的邮件。"""
    email_addr, pwd, _, smtp_override = _resolve(
        account_id, account, password, None, smtp_server
    )
    sender = EmailSender(
        account=email_addr,
        password=pwd,
        smtp_server=smtp_override or get_smtp_server(email_addr),
    )
    return sender.send_email_with_attachment(
        to_addr, subject, content, attachment_paths, cc_addr, is_html
    )


if __name__ == "__main__":
    mcp.run()
