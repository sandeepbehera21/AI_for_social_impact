import sys
import firebase_admin
from firebase_admin import credentials, firestore

# Initialize Firebase Admin using credentials
cred = credentials.Certificate("firebase-config.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

def promote_user(email):
    # Search for user by email
    users_ref = db.collection("users")
    query = users_ref.where("email", "==", email).limit(1).get()
    
    if not query:
        print(f"Error: No user found with email '{email}' in Firestore.")
        print("Make sure you have registered this email on the live website first!")
        return
        
    user_doc = query[0]
    user_id = user_doc.id
    
    # Update the user's role to admin
    users_ref.document(user_id).update({"role": "admin"})
    print(f"Success! User '{email}' (UID: {user_id}) has been promoted to 'admin'.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scratch/promote_admin.py <user_email>")
    else:
        promote_user(sys.argv[1])
