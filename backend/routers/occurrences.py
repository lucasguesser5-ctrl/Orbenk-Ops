"""Router — Ocorrências (CRUD + upload de imagens)."""
import math
import os
import uuid
from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from core.config import settings
from core.database import get_db
from core.security import get_current_user, require_roles
from models.occurrence import Occurrence, OccurrenceImage
from models.witness import Witness
from models.user import User
from schemas.occurrence import (
    OccurrenceCreate, OccurrenceUpdate, OccurrenceResponse,
    OccurrenceListItem, PaginatedOccurrences, OccurrenceImageResponse,
)

router = APIRouter(prefix="/occurrences", tags=["Ocorrências"])


def _generate_protocol(db: Session) -> str:
    """Gera protocolo único no formato OBK-YYYY-NNNN."""
    year = datetime.now(timezone.utc).year
    prefix = f"OBK-{year}-"
    last = (
        db.query(Occurrence)
        .filter(Occurrence.protocol.like(f"{prefix}%"))
        .order_by(Occurrence.id.desc())
        .first()
    )
    if last:
        try:
            seq = int(last.protocol.split("-")[-1]) + 1
        except (ValueError, IndexError):
            seq = 1
    else:
        seq = 1
    return f"{prefix}{seq:04d}"


def _build_image_url(request: Request, occurrence_id: int, filename: str) -> str:
    """Constrói a URL pública de uma imagem."""
    base = str(request.base_url).rstrip("/")
    return f"{base}/uploads/{occurrence_id}/{filename}"


def _occurrence_to_response(occ: Occurrence, request: Request) -> OccurrenceResponse:
    """Converte model para schema de resposta, incluindo URLs das imagens."""
    data = OccurrenceResponse.model_validate(occ)
    data.images = [
        OccurrenceImageResponse(
            id=img.id,
            filename=img.filename,
            original_name=img.original_name,
            file_size=img.file_size,
            uploaded_at=img.uploaded_at,
            url=_build_image_url(request, occ.id, img.filename),
        )
        for img in occ.images
    ]
    return data


# ─────────────────────────────────────────
# Listagem com filtros e paginação
# ─────────────────────────────────────────

@router.get("/", response_model=PaginatedOccurrences)
def list_occurrences(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status_filter: str | None = Query(None, alias="status"),
    city: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lista ocorrências com filtros e paginação."""
    q = db.query(Occurrence)

    # Operadores veem apenas as próprias ocorrências
    if current_user.role == "operador":
        q = q.filter(Occurrence.operator_id == current_user.id)

    if status_filter:
        q = q.filter(Occurrence.status == status_filter)
    if city:
        q = q.filter(Occurrence.city.ilike(f"%{city}%"))
    if date_from:
        q = q.filter(Occurrence.occurrence_date >= date_from)
    if date_to:
        q = q.filter(Occurrence.occurrence_date <= date_to)
    if search:
        term = f"%{search}%"
        q = q.filter(
            Occurrence.protocol.ilike(term)
            | Occurrence.client.ilike(term)
            | Occurrence.address.ilike(term)
            | Occurrence.narrative.ilike(term)
        )

    total = q.count()
    pages = math.ceil(total / limit) if total else 1
    items = q.order_by(Occurrence.created_at.desc()).offset((page - 1) * limit).limit(limit).all()

    return PaginatedOccurrences(
        items=[OccurrenceListItem.model_validate(o) for o in items],
        total=total,
        page=page,
        limit=limit,
        pages=pages,
    )


# ─────────────────────────────────────────
# Criar
# ─────────────────────────────────────────

@router.post("/", response_model=OccurrenceResponse, status_code=201)
def create_occurrence(
    request: Request,
    body: OccurrenceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Cria uma nova ocorrência."""
    protocol = body.protocol or _generate_protocol(db)
    if db.query(Occurrence).filter(Occurrence.protocol == protocol).first():
        protocol = _generate_protocol(db)

    witnesses_data = body.witnesses
    occ_data = body.model_dump(exclude={"protocol", "witnesses"})

    occ = Occurrence(protocol=protocol, operator_id=current_user.id, **occ_data)
    db.add(occ)
    db.flush()  # obtém o ID

    for w in witnesses_data:
        db.add(Witness(occurrence_id=occ.id, **w.model_dump()))

    db.commit()
    db.refresh(occ)
    return _occurrence_to_response(occ, request)


# ─────────────────────────────────────────
# Detalhe
# ─────────────────────────────────────────

@router.get("/{occurrence_id}", response_model=OccurrenceResponse)
def get_occurrence(
    request: Request,
    occurrence_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retorna o detalhe completo de uma ocorrência."""
    occ = db.query(Occurrence).filter(Occurrence.id == occurrence_id).first()
    if not occ:
        raise HTTPException(status_code=404, detail="Ocorrência não encontrada")
    if current_user.role == "operador" and occ.operator_id != current_user.id:
        raise HTTPException(status_code=403, detail="Acesso negado")
    return _occurrence_to_response(occ, request)


# ─────────────────────────────────────────
# Atualizar
# ─────────────────────────────────────────

@router.put("/{occurrence_id}", response_model=OccurrenceResponse)
def update_occurrence(
    request: Request,
    occurrence_id: int,
    body: OccurrenceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Atualiza uma ocorrência."""
    occ = db.query(Occurrence).filter(Occurrence.id == occurrence_id).first()
    if not occ:
        raise HTTPException(status_code=404, detail="Ocorrência não encontrada")
    if current_user.role == "operador" and occ.operator_id != current_user.id:
        raise HTTPException(status_code=403, detail="Acesso negado")

    witnesses_data = body.witnesses
    update_data = body.model_dump(exclude_none=True, exclude={"witnesses"})
    for field, value in update_data.items():
        setattr(occ, field, value)

    if witnesses_data is not None:
        # Substitui todas as testemunhas
        db.query(Witness).filter(Witness.occurrence_id == occ.id).delete()
        for w in witnesses_data:
            db.add(Witness(occurrence_id=occ.id, **w.model_dump()))

    db.commit()
    db.refresh(occ)
    return _occurrence_to_response(occ, request)


# ─────────────────────────────────────────
# Deletar
# ─────────────────────────────────────────

@router.delete("/{occurrence_id}", status_code=204)
def delete_occurrence(
    occurrence_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("supervisor", "admin")),
):
    """Remove uma ocorrência (supervisor ou admin)."""
    occ = db.query(Occurrence).filter(Occurrence.id == occurrence_id).first()
    if not occ:
        raise HTTPException(status_code=404, detail="Ocorrência não encontrada")
    db.delete(occ)
    db.commit()


# ─────────────────────────────────────────
# Upload de Imagens
# ─────────────────────────────────────────

ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/gif"}


@router.post("/{occurrence_id}/images", response_model=list[OccurrenceImageResponse])
async def upload_images(
    request: Request,
    occurrence_id: int,
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Faz upload de múltiplas imagens para uma ocorrência."""
    occ = db.query(Occurrence).filter(Occurrence.id == occurrence_id).first()
    if not occ:
        raise HTTPException(status_code=404, detail="Ocorrência não encontrada")
    if current_user.role == "operador" and occ.operator_id != current_user.id:
        raise HTTPException(status_code=403, detail="Acesso negado")

    save_dir = os.path.join(settings.UPLOAD_DIR, str(occurrence_id))
    os.makedirs(save_dir, exist_ok=True)

    saved = []
    for file in files:
        if file.content_type not in ALLOWED_MIME:
            raise HTTPException(status_code=400, detail=f"Tipo não suportado: {file.content_type}")

        content = await file.read()
        if len(content) > settings.MAX_UPLOAD_SIZE:
            raise HTTPException(status_code=400, detail="Arquivo muito grande (máx. 10MB)")

        ext = os.path.splitext(file.filename or "img.jpg")[1]
        safe_name = f"{uuid.uuid4().hex}{ext}"
        file_path = os.path.join(save_dir, safe_name)

        with open(file_path, "wb") as f:
            f.write(content)

        img = OccurrenceImage(
            occurrence_id=occurrence_id,
            filename=safe_name,
            original_name=file.filename or safe_name,
            file_size=len(content),
        )
        db.add(img)
        db.flush()

        saved.append(OccurrenceImageResponse(
            id=img.id,
            filename=img.filename,
            original_name=img.original_name,
            file_size=img.file_size,
            uploaded_at=img.uploaded_at,
            url=_build_image_url(request, occurrence_id, safe_name),
        ))

    db.commit()
    return saved


@router.delete("/{occurrence_id}/images/{image_id}", status_code=204)
def delete_image(
    occurrence_id: int,
    image_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove uma imagem específica de uma ocorrência."""
    img = db.query(OccurrenceImage).filter(
        OccurrenceImage.id == image_id,
        OccurrenceImage.occurrence_id == occurrence_id,
    ).first()
    if not img:
        raise HTTPException(status_code=404, detail="Imagem não encontrada")

    file_path = os.path.join(settings.UPLOAD_DIR, str(occurrence_id), img.filename)
    if os.path.exists(file_path):
        os.remove(file_path)

    db.delete(img)
    db.commit()
