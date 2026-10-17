"""Serviço de geração de PDF com WeasyPrint — Estética Militar."""
import base64
import os
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from models.occurrence import Occurrence
from core.config import settings


def _load_image_b64(occurrence_id: int, filename: str) -> str | None:
    """Carrega imagem do disco e retorna como base64 para embed no HTML."""
    path = os.path.join(settings.UPLOAD_DIR, str(occurrence_id), filename)
    if not os.path.exists(path):
        return None
    ext = os.path.splitext(filename)[1].lstrip(".").lower()
    mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    return f"data:{mime};base64,{data}"


def _fmt_date(d) -> str:
    if not d:
        return "—"
    if hasattr(d, "strftime"):
        return d.strftime("%d/%m/%Y")
    return str(d)


def _fmt_list(items: list) -> str:
    if not items:
        return "Nenhum"
    return " · ".join(items)


def _build_html(occ: Occurrence) -> str:
    """Constrói o HTML completo do relatório para renderização com WeasyPrint."""
    emitted_at = datetime.now(timezone.utc).strftime("%d/%m/%Y às %H:%M UTC")

    operator_name = occ.operator.full_name if occ.operator else "—"
    operator_role = occ.operator.role.upper() if occ.operator else ""

    # Imagens
    images_html = ""
    if occ.images:
        imgs = []
        for img in occ.images[:12]:  # máximo 12 imagens no PDF
            b64 = _load_image_b64(occ.id, img.filename)
            if b64:
                imgs.append(f'<img src="{b64}" alt="{img.original_name}" class="evidence-img">')
        if imgs:
            images_html = f"""
            <div class="section">
                <div class="section-title">08 — REGISTRO FOTOGRÁFICO / EVIDÊNCIAS</div>
                <div class="img-grid">{''.join(imgs)}</div>
            </div>"""

    # Testemunhas
    witnesses_html = ""
    if occ.witnesses:
        rows = "".join(
            f"""<tr>
                <td>{i+1}</td>
                <td>{w.name or '—'}</td>
                <td>{w.phone or '—'}</td>
                <td>{w.document or '—'}</td>
            </tr>"""
            for i, w in enumerate(occ.witnesses)
        )
        witnesses_html = f"""
        <div class="section">
            <div class="section-title">06 — TESTEMUNHAS REGISTRADAS</div>
            <table class="wit-table">
                <thead><tr><th>#</th><th>Nome</th><th>Telefone</th><th>Documento</th></tr></thead>
                <tbody>{rows}</tbody>
            </table>
        </div>"""

    status_label = {
        "em_andamento": "EM ANDAMENTO",
        "concluida": "CONCLUÍDA",
        "arquivada": "ARQUIVADA",
    }.get(occ.status, occ.status.upper())

    danos_html = ""
    if occ.damage_description:
        danos_html = f"""
        <div class="section">
            <div class="section-title">05 — DANOS E PERDAS MATERIAIS</div>
            <div class="narrative-box">{occ.damage_description}</div>
            <div class="field-row">
                <div class="field-item"><span class="label">Boletim de Ocorrência</span><span class="value">{occ.bo_number or 'Não registrado'}</span></div>
            </div>
        </div>"""

    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<style>
  @page {{
    size: A4 portrait;
    margin: 12mm 15mm;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
    font-size: 8.5pt;
    color: #0f1c2e;
    line-height: 1.45;
    background: #ffffff;
  }}

  /* ── CABEÇALHO ── */
  .header {{
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 3px solid #0d2a54;
    padding-bottom: 6px;
    margin-bottom: 10px;
  }}
  .brand {{ display: flex; align-items: center; gap: 12px; }}
  .brand-name {{
    font-size: 22pt;
    font-weight: 900;
    color: #0d2a54;
    letter-spacing: -1px;
  }}
  .brand-sub {{ font-size: 7.5pt; color: #4a6080; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }}
  .doc-meta {{ text-align: right; font-size: 7.5pt; color: #3a4e65; }}
  .doc-meta .protocol-badge {{
    font-size: 12pt;
    font-weight: 900;
    color: #0d2a54;
    font-family: 'Courier New', monospace;
    letter-spacing: 1px;
  }}
  .doc-meta .status-badge {{
    display: inline-block;
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 7pt;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    background: #fbbf24;
    color: #78350f;
    margin-top: 3px;
  }}
  .doc-title {{
    font-size: 9pt;
    font-weight: bold;
    color: #0d2a54;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 4px;
    border-top: 1px solid #cbd5e1;
    padding-top: 4px;
  }}

  /* ── SEÇÕES ── */
  .section {{
    border: 1px solid #cbd5e1;
    border-left: 3px solid #0d2a54;
    border-radius: 3px;
    padding: 7px 10px;
    margin-bottom: 7px;
    page-break-inside: avoid;
  }}
  .section-title {{
    font-size: 7.5pt;
    font-weight: bold;
    color: #0d2a54;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 3px;
    margin-bottom: 6px;
  }}

  /* ── CAMPOS ── */
  .field-row {{ display: flex; flex-wrap: wrap; gap: 6px 12px; }}
  .field-item {{ flex: 1; min-width: 140px; }}
  .field-item.full {{ flex: 0 0 100%; }}
  .label {{
    display: block;
    font-size: 6.5pt;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #64748b;
    font-weight: bold;
    margin-bottom: 1px;
  }}
  .value {{
    font-size: 8.5pt;
    color: #0f172a;
    font-weight: 500;
  }}
  .value.mono {{
    font-family: 'Courier New', monospace;
    font-size: 9pt;
    font-weight: bold;
    color: #0d2a54;
  }}
  .badge {{
    display: inline-block;
    background: #e2e8f0;
    color: #334155;
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 7pt;
    font-weight: bold;
    margin: 1px 2px 1px 0;
  }}
  .badge.blue {{ background: #dbeafe; color: #1e40af; }}
  .badge.red {{ background: #fee2e2; color: #991b1b; }}
  .badge.green {{ background: #d1fae5; color: #065f46; }}
  .badge.amber {{ background: #fef3c7; color: #92400e; }}

  /* ── NARRATIVA ── */
  .narrative-box {{
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 3px;
    padding: 6px 8px;
    font-size: 8pt;
    color: #1e293b;
    white-space: pre-wrap;
    margin-top: 4px;
  }}

  /* ── TESTEMUNHAS ── */
  .wit-table {{ width: 100%; border-collapse: collapse; font-size: 7.5pt; }}
  .wit-table th {{
    background: #0d2a54;
    color: white;
    padding: 3px 6px;
    text-align: left;
    text-transform: uppercase;
    font-size: 6.5pt;
    letter-spacing: 0.5px;
  }}
  .wit-table td {{ padding: 3px 6px; border-bottom: 1px solid #e2e8f0; }}
  .wit-table tr:nth-child(even) td {{ background: #f8fafc; }}

  /* ── IMAGENS ── */
  .img-grid {{
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }}
  .evidence-img {{
    width: 80px;
    height: 60px;
    object-fit: cover;
    border-radius: 3px;
    border: 1px solid #cbd5e1;
  }}

  /* ── RODAPÉ ── */
  .footer {{
    border-top: 2px solid #0d2a54;
    margin-top: 8px;
    padding-top: 4px;
    display: flex;
    justify-content: space-between;
    font-size: 6.5pt;
    color: #64748b;
  }}
  .sig-line {{
    margin-top: 14px;
    display: flex;
    justify-content: space-between;
    gap: 20px;
  }}
  .sig-box {{
    flex: 1;
    border-top: 1px solid #475569;
    padding-top: 3px;
    text-align: center;
    font-size: 6.5pt;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }}
</style>
</head>
<body>

<!-- CABEÇALHO -->
<div class="header">
  <div class="brand">
    <div>
      <div class="brand-name">Orbenk</div>
      <div class="brand-sub">Segurança Privada · Central de Monitoramento</div>
    </div>
  </div>
  <div class="doc-meta">
    <div class="protocol-badge">{occ.protocol}</div>
    <div class="status-badge">{status_label}</div>
    <div class="doc-title">Relatório Técnico de Atendimento Pós-Trauma</div>
    <div style="margin-top:3px;">Emissão: {emitted_at}</div>
  </div>
</div>

<!-- BLOCO 1: IDENTIFICAÇÃO -->
<div class="section">
  <div class="section-title">01 — Dados do Atendimento e Identificação</div>
  <div class="field-row">
    <div class="field-item">
      <span class="label">Protocolo</span>
      <span class="value mono">{occ.protocol}</span>
    </div>
    <div class="field-item">
      <span class="label">Operador Responsável</span>
      <span class="value">{operator_name} <small style="color:#64748b;">({operator_role})</small></span>
    </div>
    <div class="field-item">
      <span class="label">Turno</span>
      <span class="value">{occ.shift or '—'}</span>
    </div>
    <div class="field-item">
      <span class="label">Data / Hora da Ocorrência</span>
      <span class="value">{_fmt_date(occ.occurrence_date)} {('às ' + occ.occurrence_time) if occ.occurrence_time else ''}</span>
    </div>
    <div class="field-item">
      <span class="label">Status</span>
      <span class="value">{status_label}</span>
    </div>
  </div>
</div>

<!-- BLOCO 2: CLIENTE E LOCALIZAÇÃO -->
<div class="section">
  <div class="section-title">02 — Cliente e Localização do Evento</div>
  <div class="field-row">
    <div class="field-item">
      <span class="label">Cliente / Razão Social</span>
      <span class="value">{occ.client or '—'}</span>
    </div>
    <div class="field-item">
      <span class="label">Cidade / Regional</span>
      <span class="value">{occ.city or '—'}</span>
    </div>
    <div class="field-item full">
      <span class="label">Endereço Completo</span>
      <span class="value">{occ.address or '—'}</span>
    </div>
    <div class="field-item">
      <span class="label">Contato no Local</span>
      <span class="value">{occ.contact_name or '—'}</span>
    </div>
    <div class="field-item">
      <span class="label">Telefone</span>
      <span class="value">{occ.contact_phone or '—'}</span>
    </div>
    {'<div class="field-item"><span class="label">Coordenadas GPS</span><span class="value mono">' + f'{occ.lat:.6f}, {occ.lon:.6f}' + '</span></div>' if occ.lat else ''}
  </div>
</div>

<!-- BLOCO 3: CLASSIFICAÇÃO -->
<div class="section">
  <div class="section-title">03 — Classificação e Parâmetros da Ocorrência</div>
  <div class="field-row">
    <div class="field-item">
      <span class="label">Serviços Contratados</span>
      <span class="value">{''.join(f'<span class="badge blue">{s}</span>' for s in occ.contracted_services) or '—'}</span>
    </div>
    <div class="field-item">
      <span class="label">Tipos de Ocorrência</span>
      <span class="value">{''.join(f'<span class="badge red">{t}</span>' for t in occ.occurrence_types) or '—'}</span>
    </div>
    <div class="field-item">
      <span class="label">Autoridades Acionadas</span>
      <span class="value">{''.join(f'<span class="badge amber">{a}</span>' for a in occ.authorities) or 'Nenhuma'}</span>
    </div>
    <div class="field-item">
      <span class="label">Sistema de Alarme</span>
      <span class="value">{occ.alarm_status or '—'}</span>
    </div>
    <div class="field-item">
      <span class="label">Zona Disparada</span>
      <span class="value">{occ.alarm_zone or 'N/A'}</span>
    </div>
    <div class="field-item">
      <span class="label">Boletim de Ocorrência (B.O.)</span>
      <span class="value mono">{occ.bo_number or 'Não registrado'}</span>
    </div>
  </div>
</div>

<!-- BLOCO 4: MAPEAMENTO CLÍNICO E VÍTIMAS -->
<div class="section">
  <div class="section-title">04 — Mapeamento Clínico, Vítimas e Gravidade</div>
  <div class="field-row">
    <div class="field-item">
      <span class="label">Constatação de Vítimas</span>
      <span class="value">{'SIM' if occ.had_victims else 'NÃO'}</span>
    </div>
    <div class="field-item">
      <span class="label">Total de Vítimas</span>
      <span class="value mono">{occ.victim_count if occ.had_victims else 0}</span>
    </div>
    <div class="field-item">
      <span class="label">Gravidade Geral / Óbitos</span>
      <span class="value">
        {('ÓBITO CONFIRMADO (' + str(occ.fatality_count) + ')') if occ.had_fatalities else (occ.victim_severity or 'N/I')}
      </span>
    </div>
    <div class="field-item">
      <span class="label">Meio Empregado na Agressão</span>
      <span class="value">{(occ.victim_details or {}).get('aggression_means', 'Não especificado') if isinstance(occ.victim_details, dict) else 'Não especificado'}</span>
    </div>
    <div class="field-item full">
      <span class="label">Atendimento Pré-Hospitalar & Destino</span>
      <span class="value">{(occ.victim_details or {}).get('care_destination', 'Não informado / Não aplicável') if isinstance(occ.victim_details, dict) else 'Não informado'}</span>
    </div>
  </div>
</div>

<!-- BLOCO 5: SEGURANÇA PRIVADA // VIGILÂNCIA E ARMAMENTO (LEI 7.102/83) -->
<div class="section">
  <div class="section-title">05 — Segurança Privada, Armamento e Confronto (Lei Federal nº 7.102/1983)</div>
  <div class="field-row">
    <div class="field-item">
      <span class="label">Posto Operacional</span>
      <span class="value">{'COM EFETIVO (Vigilante no Posto)' if occ.guard_on_site else 'SEM VIGILANTE NO POSTO'}</span>
    </div>
    <div class="field-item">
      <span class="label">Efetivo de Vigilantes</span>
      <span class="value mono">{occ.guard_count or (1 if occ.guard_on_site else 0)}</span>
    </div>
    <div class="field-item">
      <span class="label">Identificação / CNV</span>
      <span class="value">{occ.guard_name or 'Não informado'}</span>
    </div>
    <div class="field-item">
      <span class="label">Vigilante Rendido?</span>
      <span class="value">{'SIM (Rendido)' if occ.guard_surrendered else 'NÃO'}</span>
    </div>
    <div class="field-item">
      <span class="label">Agressão / Lesão Corporal</span>
      <span class="value">{('SIM — ' + (occ.guard_injury_severity or 'Não inf.')) if occ.guard_assaulted else 'NÃO'}</span>
    </div>
    <div class="field-item">
      <span class="label">Disparos de Arma de Fogo</span>
      <span class="value">{'SIM (Confronto Armado)' if occ.guard_weapon_fired else 'NÃO'}</span>
    </div>
    <div class="field-item">
      <span class="label">Colete Balístico Subtraído</span>
      <span class="value">{'SIM (Subtraído)' if occ.vest_stolen else 'NÃO'}</span>
    </div>
    <div class="field-item full">
      <span class="label">Subtração de Armamento (Obrigação Legal Polícia Federal)</span>
      <span class="value" style="color: {'#dc2626' if occ.weapon_stolen else '#0f1c2e'}; font-weight: bold;">
        {('⚠ SUBTRAÍDA: ' + (occ.weapon_stolen_details or 'Comunicação imediata à PF obrigatória')) if occ.weapon_stolen else 'NÃO (Armamento Preservado / Não se aplica)'}
      </span>
    </div>
  </div>
</div>

<!-- BLOCO 6: AMPARO JURÍDICO & PRESERVAÇÃO DE LOCAL (CPP ARTS. 6º E 158-A) -->
<div class="section">
  <div class="section-title">06 — Amparo Jurídico, Preservação do Local e Cadeia de Custódia (CPP Arts. 6º, I e 158-A a 158-F)</div>
  <div class="field-row">
    <div class="field-item">
      <span class="label">Local de Crime Preservado</span>
      <span class="value">{'SIM (Isolado e Intacto)' if occ.crime_scene_preserved else 'NÃO / Prejudicado'}</span>
    </div>
    <div class="field-item">
      <span class="label">Perícia Oficial (IGP/Politec)</span>
      <span class="value">{'SIM (Acionada)' if occ.forensic_team_called else 'NÃO'}</span>
    </div>
    <div class="field-item">
      <span class="label">Delegacia Circunscrição</span>
      <span class="value">{occ.police_station or 'Não informada'}</span>
    </div>
    <div class="field-item">
      <span class="label">Autoridade / Prefixo VTR</span>
      <span class="value">{occ.police_officer or 'Não informado'}</span>
    </div>
    <div class="field-item full">
      <span class="label">Termo de Fé Pública Funcional & Custódia Probatória</span>
      <span class="value" style="font-size: 7pt; color: #334155;">
        {occ.legal_custody_notes or 'Declaro para os devidos fins probatórios, sob as penas da lei e fé funcional operacional, que as informações, fotos e dados georreferenciados foram coletados e preservados em estrita observância aos Arts. 158-A a 158-F do CPP.'}
      </span>
    </div>
  </div>
</div>

{danos_html}

{witnesses_html}

<!-- BLOCO 7: RELATO DETALHADO -->
<div class="section">
  <div class="section-title">07 — Relato Detalhado dos Fatos e Providências Operacionais Adotadas</div>
  <div class="narrative-box">{occ.narrative or 'Nenhum relato detalhado registrado para esta ocorrência.'}</div>
</div>

{images_html}

<!-- ASSINATURA E TERMO JURÍDICO -->
<div class="sig-line">
  <div class="sig-box">Responsável Técnico / Operador<br><small>{operator_name} ({operator_role}) · Fé Pública Operacional</small></div>
  <div class="sig-box">Coordenação de Gestão de Contratos<br><small>Supervisão Operacional & Auditoria Jurídica</small></div>
  <div class="sig-box">Representante Legal do Contratante<br><small>Ciência do Cliente / Gestor Patrimonial</small></div>
</div>

<div class="footer">
  <div>Orbenk Segurança Privada · Central Integrada de Monitoramento & Gestão de Crise</div>
  <div>Documento gerado em: {emitted_at} · Protocolo: {occ.protocol} · Amparo: Lei 7.102/83 & CPP Art. 6º</div>
  <div>DOCUMENTO DE VALOR PROBATÓRIO E PERICIAL — USO OFICIAL RESTRITO</div>
</div>

</body>
</html>"""


async def generate_occurrence_pdf(occ: Occurrence, db: Session) -> bytes:
    """
    Gera PDF profissional de uma ocorrência usando WeasyPrint.

    Args:
        occ: Instância do model Occurrence (com relacionamentos carregados).
        db: Sessão do banco (não utilizada diretamente, mas mantida para extensibilidade).

    Returns:
        Bytes do PDF gerado.
    """
    try:
        from weasyprint import HTML, CSS
    except ImportError:
        raise RuntimeError("WeasyPrint não instalado. Execute: pip install weasyprint")

    html_content = _build_html(occ)
    pdf_bytes = HTML(string=html_content, base_url=".").write_pdf()
    return pdf_bytes
