"""Ponto de entrada da aplicação Orbenk Ops API."""
import os
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from core.config import settings
from core.database import create_tables
from core.security import get_password_hash
from routers import auth, occurrences, users, reports, geo, stats


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Executa na inicialização e encerramento da aplicação."""
    # ── Startup ──
    create_tables()
    _create_default_admin()
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    yield
    # ── Shutdown ── (nada a fazer)


def _create_default_admin() -> None:
    """Cria ou atualiza o usuário admin padrão com a senha Link2026@."""
    from core.database import SessionLocal
    from models.user import User

    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.username == "admin").first()
        if not existing:
            admin = User(
                username="admin",
                full_name="Administrador",
                email="admin@orbenk.local",
                hashed_password=get_password_hash("Link2026@"),
                role="admin",
                is_active=True,
            )
            db.add(admin)
            db.commit()
            print("✅ Usuário admin criado: admin / Link2026@")
        else:
            existing.hashed_password = get_password_hash("Link2026@")
            db.commit()
            print("✅ Senha do admin sincronizada: admin / Link2026@")
    finally:
        db.close()


# ─────────────────────────────────────────
# Aplicação FastAPI
# ─────────────────────────────────────────

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="API REST para o sistema de registro de ocorrências pós-trauma da Orbenk Segurança Privada.",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ── CORS ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers da API ──
API_PREFIX = "/api/v1"
app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(occurrences.router, prefix=API_PREFIX)
app.include_router(users.router, prefix=API_PREFIX)
app.include_router(reports.router, prefix=API_PREFIX)
app.include_router(geo.router, prefix=API_PREFIX)
app.include_router(stats.router, prefix=API_PREFIX)

# ── Arquivos de upload (imagens) ──
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

# ── Frontend estático ──
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "assets")), name="assets")


# ─────────────────────────────────────────
# Endpoints utilitários
# ─────────────────────────────────────────

@app.get("/health", tags=["Sistema"])
def health_check():
    """Verificação de saúde da API."""
    return {"status": "ok", "version": settings.VERSION, "service": settings.PROJECT_NAME}


@app.get("/", include_in_schema=False)
def serve_index():
    """Serve o frontend (página de login)."""
    index = FRONTEND_DIR / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return JSONResponse({"message": f"{settings.PROJECT_NAME} API está online. Acesse /docs"})


@app.get("/{page}.html", include_in_schema=False)
def serve_page(page: str):
    """Serve páginas HTML do frontend."""
    html_file = FRONTEND_DIR / f"{page}.html"
    if html_file.exists():
        return FileResponse(str(html_file))
    return JSONResponse({"detail": "Página não encontrada"}, status_code=404)


@app.exception_handler(404)
async def not_found_handler(request: Request, exc):
    """Para rotas não encontradas que não são da API, serve o index.html (SPA)."""
    if not request.url.path.startswith("/api"):
        index = FRONTEND_DIR / "index.html"
        if index.exists():
            return FileResponse(str(index))
    return JSONResponse({"detail": "Não encontrado"}, status_code=404)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
