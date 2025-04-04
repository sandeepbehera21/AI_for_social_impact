import firebase_admin
from firebase_admin import credentials

# Load the JSON file
cred = credentials.Certificate("firebase-config.json")
firebase_admin.initialize_app(cred)
