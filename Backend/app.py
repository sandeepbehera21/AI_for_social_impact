import os
from flask import Flask, request, jsonify
from dotenv import load_dotenv
import google.generativeai as genai
from flask_cors import CORS
# Load environment variables
load_dotenv()
API_KEY = os.getenv("GEMINI_API_KEY")
#print(API_KEY);
# Initialize Gemini AI (Ensure API key is set)
if API_KEY:
    genai.configure(api_key=API_KEY)
    model = genai.GenerativeModel("gemini-pro")
else:
    print("Error: GEMINI_API_KEY is missing. Please check your .env file.")
# Flask app setup

app = Flask(__name__)
CORS(app)  # This will allow all domains to access the API

@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    user_input = data.get("message", "")

    if not user_input:
        return jsonify({"error": "Message is required"}), 400
    
    try:
        response = model.generate_content(user_input)
        ai_response = response.text if response else "Sorry, I couldn't understand that."
    except Exception as e:
        ai_response = f"Error: {str(e)}"

    return jsonify({"response": ai_response})

if __name__ == "__main__":
    app.run(debug=True)
