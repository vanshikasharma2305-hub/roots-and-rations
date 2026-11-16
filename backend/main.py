
import os
import base64
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from pydantic import BaseModel, EmailStr
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, Session

from groq import (
    Groq,
    AuthenticationError,
    RateLimitError,
    APIConnectionError,
    APIStatusError
)


# --------------------------------------------------
# CONFIGURATION
# --------------------------------------------------

load_dotenv()

SECRET_KEY = os.getenv(
    "SECRET_KEY",
    "development-secret-change-this"
)

ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24 * 7

# GROQ CONFIGURATION
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()

GROQ_MODEL = os.getenv(
    "GROQ_MODEL",
    "openai/gpt-oss-20b"
)

GROQ_VISION_MODEL = os.getenv(
    "GROQ_VISION_MODEL",
    "qwen/qwen3.8-27b"
)

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace(
        "postgresql://",
        "postgresql+psycopg://",
        1
    )

if not DATABASE_URL:
    DATABASE_URL = "sqlite:///./roots_and_rations.db"

engine_options = {}

if DATABASE_URL.startswith("sqlite"):
    engine_options["connect_args"] = {
        "check_same_thread": False
    }

engine = create_engine(
    DATABASE_URL,
    **engine_options
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()


# --------------------------------------------------
# DATABASE TABLES
# --------------------------------------------------

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


Base.metadata.create_all(bind=engine)


# --------------------------------------------------
# FASTAPI APPLICATION
# --------------------------------------------------

app = FastAPI(
    title="Roots & Rations API",
    description="Your AI-powered food, kitchen and gardening companion.",
    version="2.0.0"
)

origins = [
    item.strip()
    for item in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5500"
    ).split(",")
    if item.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer(auto_error=False)


# --------------------------------------------------
# DATABASE DEPENDENCY
# --------------------------------------------------

def get_db():
    db = SessionLocal()

    try:
        yield db
    finally:
        db.close()


# --------------------------------------------------
# AUTHENTICATION
# --------------------------------------------------

def create_access_token(user_id: int):

    expires = datetime.now(timezone.utc) + timedelta(
        hours=TOKEN_EXPIRE_HOURS
    )

    payload = {
        "sub": str(user_id),
        "exp": expires
    }

    return jwt.encode(
        payload,
        SECRET_KEY,
        algorithm=ALGORITHM
    )


def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
):

    if not credentials:
        return None

    try:
        payload = jwt.decode(
            credentials.credentials,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )

        user_id = int(payload.get("sub"))

        return db.query(User).filter(
            User.id == user_id
        ).first()

    except (JWTError, ValueError, TypeError):
        return None


def get_current_user(user=Depends(get_optional_user)):

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Please log in to access your account."
        )

    return user


# --------------------------------------------------
# REQUEST SCHEMAS
# --------------------------------------------------

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ChatRequest(BaseModel):
    message: str


# --------------------------------------------------
# ROOT AND HEALTH ENDPOINTS
# --------------------------------------------------

@app.get("/")
def home():

    return {
        "app": "Roots & Rations",
        "message": "Grow. Cook. Nourish.",
        "status": "running",
        "ai_provider": "Groq"
    }


@app.get("/health")
def health():

    return {
        "status": "healthy",
        "database": "configured",
        "ai_provider": "Groq",
        "ai_configured": bool(
            GROQ_API_KEY and
            GROQ_API_KEY != "PASTE_YOUR_GROQ_KEY_HERE"
        ),
        "text_model": GROQ_MODEL,
        "vision_model": GROQ_VISION_MODEL
    }


# --------------------------------------------------
# REGISTER
# --------------------------------------------------

@app.post("/auth/register")
def register(
    data: RegisterRequest,
    db: Session = Depends(get_db)
):

    if len(data.password) < 8:
        raise HTTPException(
            status_code=400,
            detail="Password must contain at least 8 characters."
        )

    existing = db.query(User).filter(
        User.email == data.email.lower()
    ).first()

    if existing:
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists."
        )

    hashed = bcrypt.hashpw(
        data.password.encode("utf-8"),
        bcrypt.gensalt()
    ).decode("utf-8")

    user = User(
        email=data.email.lower(),
        password_hash=hashed
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id)

    return {
        "message": "Account created successfully!",
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email
        }
    }


# --------------------------------------------------
# LOGIN
# --------------------------------------------------

@app.post("/auth/login")
def login(
    data: LoginRequest,
    db: Session = Depends(get_db)
):

    user = db.query(User).filter(
        User.email == data.email.lower()
    ).first()

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Incorrect email or password."
        )

    valid = bcrypt.checkpw(
        data.password.encode("utf-8"),
        user.password_hash.encode("utf-8")
    )

    if not valid:
        raise HTTPException(
            status_code=401,
            detail="Incorrect email or password."
        )

    return {
        "message": "Login successful!",
        "access_token": create_access_token(user.id),
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email
        }
    }


# --------------------------------------------------
# CURRENT USER
# --------------------------------------------------

@app.get("/auth/me")
def get_me(user=Depends(get_current_user)):

    return {
        "id": user.id,
        "email": user.email
    }


# --------------------------------------------------
# ROOTS & RATIONS AI INSTRUCTIONS
# --------------------------------------------------


SYSTEM_INSTRUCTION = """
You are Roots & Rations, a friendly and knowledgeable food,
cooking, kitchen and home gardening assistant.

PERSONALITY:
- Warm, natural and conversational.
- Helpful, practical and encouraging.
- Explain things simply.
- Avoid unnecessarily long answers.

FORMATTING RULES:
- Use a short, descriptive heading when useful.
- Prefer bullet points over large tables.
- Do not use tables unless the user specifically requests one
  or a comparison genuinely requires it.
- Keep paragraphs short, ideally 1-3 sentences.
- Use numbered steps for instructions and recipes.
- Bold important words, quantities and warnings.
- Use metric measurements.
- Use a few relevant emojis, but do not overuse them.
- Avoid repeating the question in the answer.
- Do not add unnecessary introductions or conclusions.

ANSWER LENGTH:
- Simple questions: 3-6 useful bullet points.
- Detailed questions: use clear sections.
- Give enough detail to be useful without overwhelming the user.
- Do not list every possible option unless requested.

GARDENING:
- Give practical advice about sunlight, watering, soil and pots.
- Consider the user's climate when relevant.
- Never claim certainty when diagnosing plants from photographs.

COOKING:
- Include ingredients and clear cooking steps when recipes are requested.
- Use commonly available ingredients where possible.
- Include cooking time and serving suggestions when useful.

VOICE:
- Return text responses only.
- Never instruct the frontend to speak automatically.

Your goal is to make Roots & Rations feel like a helpful,
intelligent and approachable companion.
"""


# --------------------------------------------------
# GROQ AI CHAT FUNCTION
# --------------------------------------------------

def ask_groq(
    message: str,
    image_data: bytes = None,
    mime_type: str = None
):

    if not GROQ_API_KEY or GROQ_API_KEY == "PASTE_YOUR_GROQ_KEY_HERE":

        raise HTTPException(
            status_code=503,
            detail="Groq API key is not configured. Please check backend/.env."
        )

    # Select the appropriate model.
    if image_data:
        selected_model = GROQ_VISION_MODEL
    else:
        selected_model = GROQ_MODEL

    try:

        # Groq SDK retries certain temporary failures automatically.
        client = Groq(
            api_key=GROQ_API_KEY,
            max_retries=2,
            timeout=45.0
        )

        # Normal text request.
        user_content = message

        # Image request.
        if image_data:

            encoded_image = base64.b64encode(
                image_data
            ).decode("utf-8")

            image_url = (
                f"data:{mime_type or 'image/jpeg'};"
                f"base64,{encoded_image}"
            )

            user_content = [
                {
                    "type": "text",
                    "text": message
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": image_url
                    }
                }
            ]

        response = client.chat.completions.create(

            model=selected_model,

            messages=[
                {
                    "role": "system",
                    "content": SYSTEM_INSTRUCTION
                },
                {
                    "role": "user",
                    "content": user_content
                }
            ],

            max_completion_tokens=1200

        )

        answer = response.choices[0].message.content

        if not answer:

            raise HTTPException(
                status_code=502,
                detail="The AI returned an empty response. Please try again."
            )

        return answer.strip()

    except HTTPException:
        raise

    except AuthenticationError as exc:

        print("Groq authentication error:", str(exc))

        raise HTTPException(
            status_code=503,
            detail="Groq rejected the API key. Please check your GROQ_API_KEY."
        )

    except RateLimitError as exc:

        print("Groq rate limit error:", str(exc))

        raise HTTPException(
            status_code=429,
            detail="Groq usage limit reached. Please wait for your free-tier quota to reset."
        )

    except APIConnectionError as exc:

        print("Groq connection error:", str(exc))

        raise HTTPException(
            status_code=502,
            detail="Could not connect to Groq. Please check your internet connection and try again."
        )

    except APIStatusError as exc:

        print(
            "Groq API error:",
            exc.status_code,
            str(exc)
        )

        if exc.status_code == 429:
            raise HTTPException(
                status_code=429,
                detail="Groq usage limit reached. Please try again later."
            )

        if exc.status_code >= 500:
            raise HTTPException(
                status_code=503,
                detail="Groq is temporarily unavailable. Please try again shortly."
            )

        raise HTTPException(
            status_code=502,
            detail="Groq could not process the request. Check the selected model and request."
        )

    except Exception as exc:

        print("Unexpected Groq error:", repr(exc))

        raise HTTPException(
            status_code=502,
            detail="The AI service could not respond. Please try again."
        )


# --------------------------------------------------
# CHAT ENDPOINT - GUEST AND REGISTERED USERS
# --------------------------------------------------

@app.post("/chat")
def chat(

    message: str = Form(...),

    image: Optional[UploadFile] = File(None),

    user=Depends(get_optional_user),

    db: Session = Depends(get_db)

):

    if not message.strip() and not image:

        raise HTTPException(
            status_code=400,
            detail="Please enter a message or attach an image."
        )

    image_data = None
    mime_type = None

    if image:

        allowed_image_types = [
            "image/jpeg",
            "image/png",
            "image/webp"
        ]

        if image.content_type not in allowed_image_types:

            raise HTTPException(
                status_code=400,
                detail="Please upload a JPG, PNG or WEBP image."
            )

        image_data = image.file.read()

        if len(image_data) > 8 * 1024 * 1024:

            raise HTTPException(
                status_code=413,
                detail="Image must be smaller than 8 MB."
            )

        mime_type = image.content_type

    prompt = message.strip() or (
        "Please examine this image and help me understand what I am seeing."
    )

    # Send request to Groq.
    answer = ask_groq(
        prompt,
        image_data,
        mime_type
    )

    # Save messages only for logged-in users.
    if user:

        db.add(
            ChatMessage(
                user_id=user.id,
                role="user",
                content=prompt
            )
        )

        db.add(
            ChatMessage(
                user_id=user.id,
                role="assistant",
                content=answer
            )
        )

        db.commit()

    return {
        "reply": answer,
        "guest": user is None
    }


# --------------------------------------------------
# CHAT HISTORY
# --------------------------------------------------

@app.get("/chat/history")
def chat_history(
    user=Depends(get_current_user),
    db: Session = Depends(get_db)
):

    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.user_id == user.id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )

    return [
        {
            "id": item.id,
            "role": item.role,
            "content": item.content,
            "created_at": item.created_at.isoformat()
        }
        for item in messages
    ]


# --------------------------------------------------
# DELETE ACCOUNT AND ASSOCIATED CHAT DATA
# --------------------------------------------------

@app.delete("/auth/account")
def delete_account(
    user=Depends(get_current_user),
    db: Session = Depends(get_db)
):

    db.query(ChatMessage).filter(
        ChatMessage.user_id == user.id
    ).delete()

    db.delete(user)
    db.commit()

    return {
        "message": "Your account and associated chat history were deleted."
    }
