@echo off
chcp 65001 >nul
echo Starting embedding generation...
:loop
node K:\joubun-kun-web\scripts\generate_paragraph_embeddings.cjs
if %errorlevel% equ 0 (
    echo Done!
    pause
    exit /b 0
)
echo Error occurred, retrying in 10 seconds...
timeout /t 10 /nobreak >nul
goto loop
