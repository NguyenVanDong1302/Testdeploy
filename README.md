# Personal Machine Full-Stack App

Full-stack app mau toi gian:

- `frontend`: React + TypeScript + Vite, deploy len Vercel
- `backend`: Node.js + Express + TypeScript + MongoDB, chay tren may ca nhan cua ban

App mau la danh sach cong viec. Frontend goi API qua bien moi truong `VITE_API_BASE_URL`.

## 1. Cau truc

```text
frontend/   React + TypeScript
backend/    Express + TypeScript + MongoDB
```

## 2. Chuan bi MongoDB

Ban co 2 lua chon:

1. MongoDB local tren may ca nhan:

```powershell
mongodb://127.0.0.1:27017/personal_tasks
```

2. MongoDB Atlas:

- Tao cluster
- Lay connection string
- Gan vao `MONGO_URI`

## 3. Cai dependency

PowerShell cua ban hien dang chan `npm.ps1`, vi vay tren Windows hay dung:

```powershell
cmd /c npm --prefix backend install
cmd /c npm --prefix frontend install
```

Neu muon chay qua root:

```powershell
cmd /c npm run install:backend
cmd /c npm run install:frontend
```

## 4. Cau hinh backend

Tao file `backend/.env` tu `backend/.env.example` va sua gia tri:

```powershell
Copy-Item backend/.env.example backend/.env
```

Gia tri quan trong:

- `MONGO_URI`: connection string MongoDB
- `PORT`: cong backend, mac dinh `4000`
- `CORS_ORIGINS`: danh sach domain duoc goi API, cach nhau boi dau phay

Vi du:

```env
PORT=4000
MONGO_URI=mongodb://127.0.0.1:27017/personal_tasks
CORS_ORIGINS=http://localhost:5173,https://your-app.vercel.app
```

Chay backend:

```powershell
cmd /c npm --prefix backend run dev
```

Health check:

```text
http://localhost:4000/api/health
```

## 5. Cau hinh frontend

Tao file `frontend/.env` tu `frontend/.env.example`:

```powershell
Copy-Item frontend/.env.example frontend/.env
```

Vi du local:

```env
VITE_API_BASE_URL=http://localhost:4000
```

Chay frontend:

```powershell
cmd /c npm --prefix frontend run dev
```

## 6. Deploy frontend len Vercel

1. Day repo len GitHub.
2. Trong Vercel, import repo nay.
3. Dat **Root Directory** la `frontend`.
4. Them environment variable:

```env
VITE_API_BASE_URL=https://your-public-backend-domain
```

5. Deploy.

## 7. Backend tren may ca nhan nhung van truy cap moi thiet bi

Frontend tren Vercel **khong the goi `localhost` cua may ban**. Backend tren may ca nhan phai co URL public, vi du:

- Cloudflare Tunnel
- ngrok
- Port forwarding + domain/DDNS + reverse proxy

### Cach 1: test nhanh bang Quick Tunnel

Lua chon nhanh nhat de test:

```powershell
cloudflared tunnel --url http://localhost:4000
```

Sau do lay URL HTTPS ma tunnel cap va gan vao:

- `frontend/.env` khi test tu xa
- `VITE_API_BASE_URL` tren Vercel
- `CORS_ORIGINS` trong `backend/.env`

Luu y:

- URL `trycloudflare.com` la tam thoi, co the thay doi moi lan chay lai
- Phu hop de test, khong phu hop cho cau hinh on dinh tren Vercel

### Cach 2: Cloudflare Tunnel on dinh cho Vercel

Neu ban co domain quan ly boi Cloudflare, nen dung tunnel on dinh:

1. Mo Cloudflare Dashboard.
2. Vao `Networking > Tunnels`.
3. Tao mot `Cloudflared tunnel`, vi du ten `todo-backend-pc`.
4. Trong phan public hostname, tao hostname:

```text
api.your-domain.com -> http://localhost:4000
```

5. Cloudflare se hien lenh cai tunnel service tren Windows. Chay lenh do trong CMD/PowerShell mo bang quyen Administrator.

Dang lenh thuong co dang:

```powershell
cloudflared.exe service install <TUNNEL_TOKEN>
```

6. Sau khi service chay, backend local cua ban se co URL on dinh nhu:

```text
https://api.your-domain.com
```

7. Cap nhat Vercel env:

```env
VITE_API_BASE_URL=https://api.your-domain.com
```

8. Cap nhat `backend/.env`:

```env
CORS_ORIGINS=http://localhost:5173,https://your-app.vercel.app
```

9. Restart backend local neu vua sua `.env`.

Neu ban chua co domain tren Cloudflare, hay dung Quick Tunnel truoc, sau do chuyen sang tunnel on dinh khi san sang.

## 8. Build production

```powershell
cmd /c npm --prefix backend run build
cmd /c npm --prefix frontend run build
```

## 9. Ghi chu quan trong

- Neu backend tat may hoac mat mang, frontend Vercel van mo duoc nhung API se loi.
- Neu ban muon app on dinh hon, backend nen chay bang PM2/NSSM/Docker tren may cua ban.
- Neu ban muon minh deploy frontend len Vercel ngay trong workspace nay, minh co the lam tiep o buoc sau.
