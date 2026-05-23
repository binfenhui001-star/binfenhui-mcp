"""多账号配置：从 EMAIL_MCP_ACCOUNTS_FILE 读取 JSON。"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any


@dataclass
class EmailAccount:
    id: str
    label: str
    account: str
    password: str
    imap_server: str | None = None
    smtp_server: str | None = None


class AccountStore:
    def __init__(
        self,
        accounts: list[EmailAccount],
        default_id: str | None = None,
    ) -> None:
        self.accounts = accounts
        self.default_id = default_id

    @staticmethod
    def config_path() -> str:
        return os.environ.get("EMAIL_MCP_ACCOUNTS_FILE", "").strip()

    @classmethod
    def load(cls) -> AccountStore:
        path = cls.config_path()
        if not path or not os.path.isfile(path):
            return cls(accounts=[], default_id=None)

        with open(path, encoding="utf-8") as handle:
            raw: dict[str, Any] = json.load(handle)

        accounts: list[EmailAccount] = []
        for item in raw.get("accounts") or []:
            if not isinstance(item, dict):
                continue
            account_id = str(item.get("id") or "").strip()
            email = str(item.get("account") or "").strip()
            password = str(item.get("password") or "")
            if not account_id or not email or not password:
                continue
            accounts.append(
                EmailAccount(
                    id=account_id,
                    label=str(item.get("label") or account_id).strip(),
                    account=email,
                    password=password,
                    imap_server=(
                        str(item.get("imap_server")).strip()
                        if item.get("imap_server")
                        else None
                    ),
                    smtp_server=(
                        str(item.get("smtp_server")).strip()
                        if item.get("smtp_server")
                        else None
                    ),
                )
            )

        default_id = raw.get("default_account_id")
        default_id = str(default_id).strip() if default_id else None
        return cls(accounts=accounts, default_id=default_id or None)

    def list_public(self) -> list[dict[str, str]]:
        return [
            {
                "id": acc.id,
                "label": acc.label,
                "account": acc.account,
                "imap_server": acc.imap_server or "",
                "smtp_server": acc.smtp_server or "",
            }
            for acc in self.accounts
        ]

    def resolve(self, account_id: str | None = None) -> EmailAccount:
        if not self.accounts:
            raise ValueError(
                "未配置邮箱账号。请在缤纷汇「设置 → 通用 → 邮箱账号」添加，"
                "或设置 EMAIL_MCP_ACCOUNTS_FILE 指向 accounts JSON。"
            )

        if account_id:
            needle = account_id.strip()
            for acc in self.accounts:
                if acc.id == needle:
                    return acc
            raise ValueError(f"未知 account_id: {account_id}")

        if self.default_id:
            for acc in self.accounts:
                if acc.id == self.default_id:
                    return acc

        if len(self.accounts) == 1:
            return self.accounts[0]

        ids = ", ".join(a.id for a in self.accounts)
        raise ValueError(
            f"存在多个邮箱账号，请指定 account_id。可用: {ids}"
        )
