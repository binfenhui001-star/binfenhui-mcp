"""
邮箱服务器配置与推断工具（不再使用环境变量存放敏感信息）。

提供基于邮箱域名自动匹配 SMTP/IMAP 服务器的函数。
"""

# 端口常量（如无特殊要求通常不需要修改）
SMTP_SSL_PORT = 465
IMAP_SSL_PORT = 993

# 常见邮箱域名与服务器映射（缺省按规则拼接）
PROVIDER_SMTP = {
    '163.com': 'smtp.163.com',
    '126.com': 'smtp.126.com',
    'yeah.net': 'smtp.yeah.net',
    'qq.com': 'smtp.qq.com',
    'gmail.com': 'smtp.gmail.com',
    'outlook.com': 'smtp.office365.com',
    'hotmail.com': 'smtp.office365.com',
    'live.com': 'smtp.office365.com',
    'aliyun.com': 'smtp.aliyun.com',
    'sina.com': 'smtp.sina.com',
}

PROVIDER_IMAP = {
    '163.com': 'imap.163.com',
    '126.com': 'imap.126.com',
    'yeah.net': 'imap.yeah.net',
    'qq.com': 'imap.qq.com',
    'gmail.com': 'imap.gmail.com',
    'outlook.com': 'outlook.office365.com',
    'hotmail.com': 'outlook.office365.com',
    'live.com': 'outlook.office365.com',
    'aliyun.com': 'imap.aliyun.com',
    'sina.com': 'imap.sina.com',
}


def _infer_domain_from_email(email: str) -> str:
    """从邮箱地址中提取域名部分。"""
    if not email or '@' not in email:
        return ''
    return email.split('@')[-1].strip().lower()


def get_smtp_server(email: str) -> str:
    """根据邮箱地址自动匹配 SMTP 服务器。未命中映射则返回 smtp.{domain}。"""
    domain = _infer_domain_from_email(email)
    if not domain:
        return ''
    return PROVIDER_SMTP.get(domain, f"smtp.{domain}")


def get_imap_server(email: str) -> str:
    """根据邮箱地址自动匹配 IMAP 服务器。未命中映射则返回 imap.{domain}。"""
    domain = _infer_domain_from_email(email)
    if not domain:
        return ''
    return PROVIDER_IMAP.get(domain, f"imap.{domain}")