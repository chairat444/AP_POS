@echo off
REM คัดลอกเป็น migrate-config.local.bat แล้วแก้ค่า (ไฟล์ local ไม่ commit)
REM   copy migrate-config.example.bat migrate-config.local.bat

REM SQL Server สาขาหลุมดิน (เครื่อง POS มักอยู่ LAN เดียวกัน → localhost หรือ IP เครื่อง server)
set MSSQL_HOST=localhost
set MSSQL_PORT=1433
set MSSQL_USER=sa
set MSSQL_PASSWORD=CHANGE_ME
set MSSQL_DB=pos_ap001

REM Postgres ปลายทาง — ทดสอบ local หรือชี้ server กลาง
set DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ap_pos

set BRANCH_CODE=001
set BRANCH_NAME=สาขาหลุมดิน
