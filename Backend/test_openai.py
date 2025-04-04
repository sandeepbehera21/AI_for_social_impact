import google.generativeai as genai
import os
from dotenv import load_dotenv

# Suppress gRPC warning
os.environ["GRPC_ENABLE_FORK_SUPPORT"] = "0"

# Load environment variables
load_dotenv()

# Configure Gemini API with API key from .env file
gemini_api_key = os.getenv("GEMINI_API_KEY")
if not gemini_api_key:
    raise ValueError("GEMINI_API_KEY is not set in the environment variables")

genai.configure(api_key=gemini_api_key)

# Load the Gemini model
model = genai.GenerativeModel("gemini-pro")

# Test OpenAI API
user_message = "Hello, how are you?"

try:
    response = model.generate_content(user_message)
    print("RAW RESPONSE:", response)  # Print full API response for debugging

    # Extract the response text properly
    if response and response.candidates and response.candidates[0].content.parts:
        bot_reply = response.candidates[0].content.parts[0].text
    else:
        bot_reply = "Sorry, I couldn't generate a response."

    print("BOT REPLY:", bot_reply)

except Exception as e:
    print("ERROR:", str(e))
