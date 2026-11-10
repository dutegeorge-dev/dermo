@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0\.."

set "CRM_URL=https://tlkbars.ru"
set "CONFIG_DIR=%LOCALAPPDATA%\Irbis"
set "TOKEN_FILE=%CONFIG_DIR%\mail-agent-token.txt"
if not exist "%CONFIG_DIR%" mkdir "%CONFIG_DIR%"
if exist "%TOKEN_FILE%" set /p CRM_MAIL_AGENT_TOKEN=<"%TOKEN_FILE%"

if not defined CRM_MAIL_AGENT_TOKEN (
    echo Первый запуск: вставьте ключ из CRM -^> Рассылка -^> Ящики.
    echo Ключ будет сохранён в %%LOCALAPPDATA%%\Irbis и больше не потребуется.
    set /p "CRM_MAIL_AGENT_TOKEN=Ключ агента: "
)
if not defined CRM_MAIL_AGENT_TOKEN (
    echo Ключ не указан.
    pause
    exit /b 1
)
if not exist "%TOKEN_FILE%" >"%TOKEN_FILE%" echo %CRM_MAIL_AGENT_TOKEN%

title Irbis Mail Agent
:restart
call npm run mail:agent
echo Агент остановлен. Повторный запуск через 15 секунд. Закройте окно, чтобы отменить.
timeout /t 15 /nobreak >nul
goto restart
