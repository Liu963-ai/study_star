@echo off
rem ============================================================
rem 汉字小星球 · 服务启动脚本（双击运行，或已注册登录自启）
rem 启动：8767 静态页面服务 + 7860 语音合成服务
rem 窗口最小化运行，关闭此窗口不影响已启动的服务
rem ============================================================
title 汉字小星球 - 本地服务
cd /d "D:\ZCODE\汉字小星球"

rem 若端口已被占用（服务已在跑）则跳过，避免重复启动
netstat -ano | findstr ":8767 .*LISTENING" >nul
if errorlevel 1 (
    start "HH-8767" /min cmd /c "python -m http.server 8767"
)
netstat -ano | findstr ":7860 .*LISTENING" >nul
if errorlevel 1 (
    start "HH-7860" /min cmd /c "python tts_server.py"
)
exit
