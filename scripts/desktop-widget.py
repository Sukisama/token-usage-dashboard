#!/usr/bin/env python3
"""
Token Usage Desktop Widget
A small floating window showing today's token usage.
Click to open the full dashboard. Right-click to quit.
"""

import os
import sys
import sqlite3
import subprocess
import tkinter as tk
from datetime import datetime

DB_PATH = os.path.expanduser("~/.token-usage-dashboard/usage.db")
DASHBOARD_URL = "http://localhost:7373"


def get_today_usage():
    today = datetime.now().strftime("%Y-%m-%d")
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COALESCE(SUM(total_tokens), 0) FROM usage_records WHERE date(timestamp) = ?",
            (today,),
        )
        total = cursor.fetchone()[0]
        conn.close()
        return int(total)
    except Exception:
        return 0


def format_number(n):
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}K"
    return str(n)


def open_dashboard(event=None):
    subprocess.Popen(["open", DASHBOARD_URL])


def start_server():
    """Start the Node server if not running."""
    try:
        import urllib.request
        urllib.request.urlopen(DASHBOARD_URL + "/api/summary", timeout=1)
    except Exception:
        project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        subprocess.Popen(
            ["node", "server.js"],
            cwd=project_dir,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


class TokenWidget:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("Token Usage")
        self.root.geometry("140x70+100+100")
        self.root.overrideredirect(True)  # No window decorations
        self.root.attributes("-topmost", True)  # Always on top
        self.root.attributes("-alpha", 0.95)
        self.root.configure(bg="#18181b")

        # Make window draggable
        self.root.bind("<Button-1>", self.start_drag)
        self.root.bind("<B1-Motion>", self.on_drag)
        self.root.bind("<ButtonRelease-1>", self.on_release)
        self.root.bind("<Button-3>", self.show_menu)

        # Content
        self.label_top = tk.Label(
            self.root,
            text="今日 Token",
            font=("SF Pro Display", 10),
            fg="#a1a1aa",
            bg="#18181b",
        )
        self.label_top.pack(pady=(8, 0))

        self.label_value = tk.Label(
            self.root,
            text="0",
            font=("SF Pro Display", 18, "bold"),
            fg="#f97316",
            bg="#18181b",
        )
        self.label_value.pack()

        # Context menu
        self.menu = tk.Menu(self.root, tearoff=0, bg="#27272a", fg="#fafafa", borderwidth=0)
        self.menu.add_command(label="打开看板", command=open_dashboard)
        self.menu.add_command(label="退出", command=self.root.quit)

        # Click behavior
        self.click_start_x = 0
        self.click_start_y = 0
        self.dragging = False

        start_server()
        self.update()

    def start_drag(self, event):
        self.click_start_x = event.x_root
        self.click_start_y = event.y_root
        self.dragging = False

    def on_drag(self, event):
        dx = event.x_root - self.click_start_x
        dy = event.y_root - self.click_start_y
        if abs(dx) > 3 or abs(dy) > 3:
            self.dragging = True
        x = self.root.winfo_x() + dx
        y = self.root.winfo_y() + dy
        self.root.geometry(f"+{x}+{y}")
        self.click_start_x = event.x_root
        self.click_start_y = event.y_root

    def on_release(self, event):
        if not self.dragging:
            open_dashboard()

    def show_menu(self, event):
        self.menu.post(event.x_root, event.y_root)

    def update(self):
        total = get_today_usage()
        self.label_value.config(text=format_number(total))
        self.root.after(5000, self.update)

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    TokenWidget().run()
