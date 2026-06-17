"""
Unit tests for the self-healing signing key mechanism during master-key mismatches.
"""
from unittest.mock import MagicMock, patch
import pytest
from fastapi import HTTPException
from app.api.clinical import _ensure_doctor_keys

@patch("app.api.clinical._sealed_private_key")
@patch("app.api.clinical.crypto.recover_private_key")
@patch("app.services.firebase.firestore_client")
def test_ensure_doctor_keys_success(
    mock_firestore,
    mock_recover_private_key,
    mock_sealed_private_key
):
    # Setup: existing keys can be recovered successfully
    mock_sealed_private_key.return_value = "sealed_private_key_data"
    mock_recover_private_key.return_value = "unsealed_private_key_pem"
    
    profile = {
        "publicKey": "existing_public_key_pem",
        "publicKeyFingerprint": "existing_fingerprint"
    }
    
    pub_key, priv_key, fp = _ensure_doctor_keys(uid="doc-123", profile=profile)
    
    assert pub_key == "existing_public_key_pem"
    assert priv_key is None  # Not newly generated
    assert fp == "existing_fingerprint"
    mock_recover_private_key.assert_called_once_with("sealed_private_key_data")


@patch("app.api.clinical._sealed_private_key")
@patch("app.api.clinical.crypto.recover_private_key")
@patch("app.api.clinical.crypto.generate_rsa_keypair")
@patch("app.api.clinical.crypto.protect_private_key")
@patch("app.api.clinical.crypto.encryption_configured")
@patch("app.services.firebase.firestore_client")
def test_ensure_doctor_keys_mismatch_triggers_regeneration(
    mock_firestore,
    mock_encryption_configured,
    mock_protect_private_key,
    mock_generate_rsa_keypair,
    mock_recover_private_key,
    mock_sealed_private_key
):
    # Setup: existing keys exist, but unsealing throws ValueError (mismatch)
    mock_sealed_private_key.return_value = "sealed_private_key_data"
    mock_recover_private_key.side_effect = ValueError("wrong key")
    
    mock_encryption_configured.return_value = True
    mock_generate_rsa_keypair.return_value = ("new_private_pem", "new_public_pem")
    mock_protect_private_key.return_value = "new_sealed_private_key"
    
    profile = {
        "publicKey": "existing_public_key_pem",
        "publicKeyFingerprint": "existing_fingerprint"
    }
    
    # Firestore mock setup
    mock_batch = MagicMock()
    mock_firestore.return_value.batch.return_value = mock_batch
    
    pub_key, priv_key, fp = _ensure_doctor_keys(uid="doc-123", profile=profile)
    
    # Assertions
    assert pub_key == "new_public_pem"
    assert priv_key == "new_private_pem"  # Freshly generated
    assert fp is not None
    
    # Verify it attempted to recover the private key, failed, and then wrote the new keys
    mock_recover_private_key.assert_called_once_with("sealed_private_key_data")
    mock_generate_rsa_keypair.assert_called_once()
    mock_batch.commit.assert_called_once()
