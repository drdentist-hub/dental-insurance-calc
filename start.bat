@echo off
chcp 65001 >nul
title 肘边备急 · 局域网共享启动器
cd /d "%~dp0"

rem ---------------------------------------------------------------
rem 依次探测 py 启动器 / python / python3，并用 `-c "import sys"` 验证可用
rem （防止命中 Windows 应用商店的 python 占位程序）
rem ---------------------------------------------------------------
set "PY="
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if not defined PY (
  python -c "import sys" >nul 2>nul && set "PY=python"
)
if not defined PY (
  python3 -c "import sys" >nul 2>nul && set "PY=python3"
)

if not defined PY (
  echo.
  echo   [错误] 没有检测到可用的 Python 3
  echo.
  echo   本项目只用 Python 标准库，装 Python 3.8+ 即可，无需 pip install。
  echo   下载地址：https://www.python.org/downloads/
  echo   安装时请勾选 "Add Python to PATH"。
  echo.
  echo   提示：不想装 Python，也可以直接双击 dist\index.html 在本机使用，
  echo         或打开在线版 https://drdentist-hub.github.io/dental-insurance-calc/
  echo.
  pause
  exit /b 1
)

echo 使用解释器：%PY%
echo.
%PY% run_app.py %*

set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo 服务已退出，错误码 %RC%
  echo 若提示端口被占用，可指定其他端口：  start.bat --port 9000
)
pause
