#!/bin/bash
cd /Users/doris/Documents/kimi/token-usage-dashboard
nohup python3 scripts/desktop-widget.py > /tmp/token-widget.log 2>&1 &
exit
