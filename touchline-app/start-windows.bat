@echo off
title Touchline
cd /d "%~dp0"
python serve.py 8000 || py serve.py 8000
pause
