@echo off
chcp 65001 >nul
title Mis Finanzas
cd /d "%~dp0"

where pnpm >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No encuentro pnpm/Node.js en este computador.
  echo  Reinicia el computador e intenta de nuevo. Si sigue igual, avisale a Claude.
  pause
  exit /b 1
)

rem Si la app ya esta abierta, solo abre el navegador
call :puerto 3000
if not errorlevel 1 goto abrir

rem 1) Base de datos (solo si no esta encendida)
call :puerto 54329
if not errorlevel 1 goto app
echo.
echo  Encendiendo la base de datos...
start "Finanzas - Base de datos (no cerrar)" /min cmd /k "pnpm db:start"
set /a intentos=0
:esperar_bd
timeout /t 2 /nobreak >nul
set /a intentos+=1
call :puerto 54329
if not errorlevel 1 goto app
if %intentos% geq 60 goto fallo_bd
goto esperar_bd

rem 2) App (API + web)
:app
echo  Encendiendo la app (la primera vez puede tardar un minuto)...
start "Finanzas - App (no cerrar)" /min cmd /k "pnpm dev"
set /a intentos=0
:esperar_app
timeout /t 3 /nobreak >nul
set /a intentos+=1
call :puerto 3000
if not errorlevel 1 goto abrir
if %intentos% geq 60 goto fallo_app
goto esperar_app

:abrir
start "" http://localhost:3000
echo.
echo  Listo! La app esta abierta en tu navegador.
echo  Para apagarla, cierra las ventanas "Finanzas" de la barra de tareas.
echo.
timeout /t 6 >nul
exit /b 0

:fallo_bd
echo.
echo  La base de datos no encendio. Abre la ventana "Finanzas - Base de datos" para ver el mensaje.
pause
exit /b 1

:fallo_app
echo.
echo  La app no encendio. Abre la ventana "Finanzas - App" para ver el mensaje.
pause
exit /b 1

rem Devuelve 0 si algo escucha en el puerto %1 (localhost), 1 si no
:puerto
powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', %1); $c.Close(); exit 0 } catch { exit 1 }"
exit /b %errorlevel%
