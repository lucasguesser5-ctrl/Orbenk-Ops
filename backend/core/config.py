"""Configurações globais da aplicação Orbenk Ops."""
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Configurações da aplicação carregadas via variáveis de ambiente."""

    PROJECT_NAME: str = "Orbenk Ops"
    VERSION: str = "1.0.0"

    # Segurança JWT
    SECRET_KEY: str = "orbenk-super-secret-key-2026-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Banco de dados
    DATABASE_URL: str = "sqlite:///./orbenk.db"

    # Uploads
    UPLOAD_DIR: str = "uploads"
    MAX_UPLOAD_SIZE: int = 10_485_760  # 10 MB

    # CORS
    CORS_ORIGINS: list[str] = ["*"]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    """Retorna instância cacheada das configurações."""
    return Settings()


settings = get_settings()
