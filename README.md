# 🤖 AI-Powered Customer Support Chatbot

An intelligent, multi-agent AI system that transforms the way businesses handle customer queries. This chatbot automates conversation summarization, action extraction, resolution recommendations, ticket routing, and resolution time prediction to ensure faster, more accurate, and scalable customer service.

---

## 🌟 Challenge Overview

In modern enterprises, customer support teams face challenges like:

- High volume of customer queries
- Delayed responses due to manual workflows
- Misrouted tickets and inconsistent resolutions

This AI system solves these problems by enabling smart automation powered by NLP and predictive analytics. It acts as a bridge between customer support agents, technical teams, and business units.

---

## ✨ Key Features

- 💬 **Natural Language Understanding** – Uses OpenAI for summarizing customer messages.
- 📌 **Action Extraction** – Identifies tasks like escalations, follow-ups, etc.
- 🔄 **Task Routing** – Auto-routes tickets to the right team using agent logic.
- 📚 **Resolution Recommendations** – Suggests solutions from historical data.
- ⏱️ **Time Estimation** – Predicts and minimizes resolution times using ML.

---

## 🧱 Project Structure


---

## 🛠️ Tech Stack

| Layer        | Technologies                          |
|--------------|----------------------------------------|
| Frontend     | HTML, CSS, JavaScript                 |
| Backend      | Python, Flask                         |
| AI/NLP       | OpenAI GPT-3.5/4                      |
| Auth/DB      | Firebase Realtime DB + Config        |
| Visualization| Chart.js                              |

---

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/sandeepbehera21/AI_for_social_impact.git
cd new-ai-chatbot

setup backend

cd Backend
python -m venv venv
venv\Scripts\activate       # (Windows)
# OR
source venv/bin/activate    # (Mac/Linux)

pip install -r requirements.txt

python app.py

