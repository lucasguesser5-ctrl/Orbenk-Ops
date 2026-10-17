# Orbenk Ops — Sistema de Gestão e Registro de Ocorrências Pós-Trauma

<div align="center">

![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=for-the-badge&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![SQLAlchemy](https://img.shields.io/badge/SQLAlchemy-2.0-D71F00?style=for-the-badge&logo=sqlalchemy&logoColor=white)
![JWT](https://img.shields.io/badge/JWT-Auth-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet.js-Maps-199900?style=for-the-badge&logo=leaflet&logoColor=white)
![Chart.js](https://img.shields.io/badge/Chart.js-4.x-FF6384?style=for-the-badge&logo=chartdotjs&logoColor=white)
![WeasyPrint](https://img.shields.io/badge/WeasyPrint-PDF-FF6B35?style=for-the-badge)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

**Plataforma tática de inteligência operacional, controle de sinistros e telemetria para segurança privada.**  
_Alta fidelidade interativa, conformidade documental e arquitetura de missão crítica._

</div>

---

## 📌 Visão Geral (Overview)

O **Orbenk Ops** é um ecossistema full-stack desenvolvido para centros de controle operacional (CCO) e empresas de segurança privada de grande porte. A plataforma digitaliza todo o ciclo de vida do atendimento pós-trauma: desde o disparo de alarmes e despacho de viaturas até a perícia documental, relato de testemunhas e emissão instantânea de laudos periciais em PDF.

A interface segue uma linguagem visual *Mission Control / Enterprise Ops*, combinando densidade analítica, alta legibilidade, telemetria geoespacial ao vivo e suporte a 4 variantes de design temático com chaveamento instantâneo.

---

## ⚡ Destaques do Sistema (Key Features)

- 🛡️ **Autenticação Segura & RBAC**: Login com criptografia `bcrypt`, tokens JWT com expiração e renovação contínua (`access_token` + `refresh_token`), e controle de permissões por perfil (*Operador*, *Supervisor* e *Administrador*).
- 🛰️ **Telemetria Satelital & Mapa Vivo**: Monitoramento em tempo real de 7 unidades operacionais móveis (viaturas táticas, patrulhas de ronda e batedores rápidos) sobrevoando a malha urbana de Joinville - SC com velocímetros, rastros luminosos e radar orbital.
- 🎨 **Arsenal de 4 Temas Sci-Fi / TRON**:
  - **Claro**: Estética institucional formal para ambientes diurnos.
  - **Escuro**: Padrão tático operacional de alto contraste.
  - **Noturno**: Tons quentes ambarinos e azul celeste para redução de fadiga ocular.
  - **Cyber**: Efeito TRON com acentos neon ciano e magenta.
- 📋 **Formulário de Atendimento Completo (13 Módulos)**:
  - Identificação de turno e operador.
  - Geocodificação de endereços com busca dinâmica (OpenStreetMap / Nominatim) e múltiplos modos de mapa.
  - Classificação de serviços e tipo de sinistro (arrombamento, invasão, disparo de alarme).
  - Status do sistema de alarme, zona e tempos de resposta (SLA).
  - Registro de vítimas e situação do efetivo no posto.
  - Descrição de danos materiais e número de Boletim de Ocorrência.
  - Anexo de fotos com upload e galeria em lightbox.
  - Gestão de testemunhas e narrativa circunstanciada.
- 📄 **Exportação de Laudo Jurídico em PDF**: Geração de relatório técnico no padrão legal via WeasyPrint, pronto para arquivo, perícia ou envio a seguradoras.
- 📊 **Dashboard com Analytics**: Métricas consolidadas, gráficos mensais, distribuição por categoria e painel meteorológico com dados em tempo real.

---

## 🛠️ Stack Tecnológica

### Backend
| Tecnologia | Função |
|---|---|
| **Python 3.12** | Linguagem central de alta performance |
| **FastAPI 0.111+** | Framework REST assíncrono de altíssima velocidade |
| **SQLAlchemy 2.0** | ORM robusto com sessões relacionais |
| **Pydantic v2** | Validação rigorosa de esquemas e contratos de dados |
| **WeasyPrint** | Renderização server-side de relatórios PDF com suporte a CSS Print |
| **python-jose & Passlib** | Algoritmos HS256 e hash de senhas com salting |
| **HTTPX** | Requisições HTTP assíncronas para geocodificação |

### Frontend
| Tecnologia | Função |
|---|---|
| **Vanilla JS (ES6+)** | Arquitetura modular e reativa sem dependências pesadas |
| **CSS3 Custom Properties** | Design System estruturado com live-preview de temas |
| **Leaflet.js 1.9** | Renderização cartográfica tática e waypoints |
| **Chart.js 4.4** | Gráficos dinâmicos de barras e rosca para métricas |

### DevOps & Deploy
| Tecnologia | Função |
|---|---|
| **Docker & Docker Compose** | Ambientes reproduzíveis e prontos para produção |
| **Uvicorn** | Servidor ASGI padrão de mercado |

---

## 🗂️ Estrutura do Repositório

```text
orbenk-ops/
├── .env.example                     # Template de variáveis de ambiente
├── .gitattributes                   # Normalização de quebras de linha e binários
├── .gitignore                       # Ignora venv, caches, logs, uploads e SQLite
├── docker-compose.yml               # Orquestração do container Docker
├── LICENSE                          # Licença MIT
├── README.md                        # Documentação do projeto
├── CLIQUE_AQUI_PARA_INICIAR.bat     # Inicializador rápido 1-clique (Windows)
├── INICIAR_ORBENK.bat               # Launcher alternativo em batch
├── serve.ps1                        # Servidor HTTP local standalone em PowerShell
├── iniciar.ps1                      # Rotina de verificação e inicialização local
│
├── backend/
│   ├── Dockerfile                   # Build de produção Python 3.12-slim
│   ├── main.py                      # Instância principal FastAPI e injeção de rotas
│   ├── requirements.txt             # Dependências Python travadas
│   ├── core/
│   │   ├── config.py                # Configurações com Pydantic Settings
│   │   ├── database.py              # Conexão SQLAlchemy e sessionmaker
│   │   └── security.py              # Hash de senhas, criação e validação JWT
│   ├── models/                      # Entidades relacionais (User, Occurrence, Witness)
│   ├── schemas/                     # Contratos de dados de entrada e saída (Pydantic)
│   ├── routers/                     # Endpoints da API (auth, occurrences, reports, stats, geo)
│   ├── services/                    # Serviços de geolocalização e geração de PDF
│   └── uploads/                     # Diretório de armazenamento de evidências fotográficas
│
└── frontend/
    ├── index.html                   # Login operacional, mapa vivo com VTRs e temas
    ├── dashboard.html               # Painel tático, meteorologia e gráficos analíticos
    ├── form.html                    # Formulário de 13 seções para registro de sinistros
    ├── occurrence.html              # Dossiê individual de ocorrência e exportação PDF
    └── assets/
        ├── css/
        │   ├── components.css       # Design tokens, modais, alertas e botões
        │   └── military.css         # Identidade tática, matriz e HUD militar
        └── js/
            ├── api.js               # Cliente HTTP com interceptor de renovação de token
            ├── dashboard.js         # Lógica de telemetria, gráficos e filtros
            ├── form.js              # Controle de etapas, autocompletar e validação
            └── occurrence.js        # Carregamento do dossiê, mapas e impressão
```

---

## 🚀 Como Executar

### Opção 1: Via Inicializador Rápido no Windows (1 Clique)
Basta dar um duplo clique no arquivo:
```cmd
CLIQUE_AQUI_PARA_INICIAR.bat
```
O sistema abrirá automaticamente o navegador em `http://localhost:8080/`.

---

### Opção 2: Via Docker Compose (Recomendado para Produção)

```bash
# 1. Clone o repositório
git clone https://github.com/SEU-USUARIO/orbenk-ops.git
cd orbenk-ops

# 2. Suba o container
docker-compose up -d

# 3. Acesse a aplicação no navegador
# http://localhost:8000
```

---

### Opção 3: Execução Manual do Backend (Python)

```bash
cd backend

# Crie e ative o ambiente virtual
python -m venv .venv

# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

# Instale os pacotes necessários
pip install -r requirements.txt

# Inicialize o servidor FastAPI
uvicorn main:app --reload --port 8000
```

---

## 🔑 Credenciais de Acesso Padrão

| Campo | Valor |
|---|---|
| **Usuário** | `admin` |
| **Senha** | `Link2026@` |
| **Perfil** | Administrador Geral (Acesso Total) |

---

## 📑 Documentação da API (OpenAPI)

Com o backend ativo, acesse a documentação interativa com testes de endpoints em tempo real:

- **Swagger UI**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **ReDoc**: [http://localhost:8000/redoc](http://localhost:8000/redoc)
- **Health Check**: [http://localhost:8000/health](http://localhost:8000/health)

---

## 🛡️ Controle de Acesso Baseado em Perfis (RBAC)

| Ação | Operador | Supervisor | Administrador |
|---|:---:|:---:|:---:|
| Registrar nova ocorrência | ✅ | ✅ | ✅ |
| Visualizar ocorrências próprias | ✅ | ✅ | ✅ |
| Visualizar ocorrências de terceiros | ❌ | ✅ | ✅ |
| Editar ocorrências | Próprias | Todas | Todas |
| Excluir ocorrências | ❌ | ✅ | ✅ |
| Exportar laudo formal em PDF | ✅ | ✅ | ✅ |
| Gestão de usuários e permissões | ❌ | ❌ | ✅ |

---

## 📄 Licença

Este projeto é distribuído sob os termos da licença **MIT**. Consulte o arquivo [LICENSE](LICENSE) para obter detalhes.
