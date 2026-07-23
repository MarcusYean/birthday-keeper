"""通知发送结果封装。"""


class NotificationResult:
    def __init__(self, ok: bool, message: str):
        self.ok = ok
        self.message = message

    def to_tuple(self):
        return (self.ok, self.message)
