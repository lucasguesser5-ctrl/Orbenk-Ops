"""Router — Geração de PDF de ocorrências."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session
from core.database import get_db
from core.security import get_current_user
from models.occurrence import Occurrence
from models.user import User
from services.pdf_service import generate_occurrence_pdf

router = APIRouter(prefix="/reports", tags=["Relatórios"])


@router.get("/{occurrence_id}/pdf")
async def download_pdf(
    occurrence_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Gera e retorna o PDF profissional de uma ocorrência."""
    occ = db.query(Occurrence).filter(Occurrence.id == occurrence_id).first()
    if not occ:
        raise HTTPException(status_code=404, detail="Ocorrência não encontrada")
    if current_user.role == "operador" and occ.operator_id != current_user.id:
        raise HTTPException(status_code=403, detail="Acesso negado")

    pdf_bytes = await generate_occurrence_pdf(occ, db)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="orbenk-{occ.protocol}.pdf"'
        },
    )
