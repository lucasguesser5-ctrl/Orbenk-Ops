"""Router — Autenticação (login, refresh, me)."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from core.database import get_db
from core.security import (
    verify_password, create_access_token, create_refresh_token,
    decode_token, get_current_user, get_password_hash,
)
from models.user import User
from schemas.auth import LoginRequest, TokenResponse, RefreshRequest, ChangePasswordRequest
from schemas.user import UserResponse

router = APIRouter(prefix="/auth", tags=["Autenticação"])


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    """Autentica o usuário e retorna access + refresh token."""
    user = db.query(User).filter(User.username == body.username, User.is_active == True).first()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário ou senha incorretos",
        )
    return TokenResponse(
        access_token=create_access_token({"sub": user.username, "role": user.role}),
        refresh_token=create_refresh_token({"sub": user.username}),
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh(body: RefreshRequest, db: Session = Depends(get_db)):
    """Gera novo access token a partir de um refresh token válido."""
    payload = decode_token(body.refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Token de refresh inválido")
    username = payload.get("sub")
    user = db.query(User).filter(User.username == username, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=401, detail="Usuário não encontrado")
    return TokenResponse(
        access_token=create_access_token({"sub": user.username, "role": user.role}),
        refresh_token=create_refresh_token({"sub": user.username}),
    )


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    """Retorna informações do usuário autenticado."""
    return current_user


@router.put("/me/password", status_code=200)
def change_password(
    body: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Altera a senha do próprio usuário autenticado."""
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Senha atual incorreta")
    current_user.hashed_password = get_password_hash(body.new_password)
    db.commit()
    return {"message": "Senha alterada com sucesso"}
