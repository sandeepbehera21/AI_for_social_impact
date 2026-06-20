import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, collection, addDoc } from 'firebase/firestore';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

let testEnv;

beforeAll(async () => {
  // Load firestore.rules relative to this test file
  const rulesPath = path.resolve(__dirname, '../../../firestore.rules');
  const rules = fs.readFileSync(rulesPath, 'utf8');

  testEnv = await initializeTestEnvironment({
    projectId: 'flowmind-559ee',
    firestore: {
      rules,
      host: '127.0.0.1',
      port: 8080
    }
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe('Firestore Security Rules', () => {
  // ---- Helper Functions ----
  function getDb(auth) {
    if (auth) {
      return testEnv.authenticatedContext(auth.uid, auth.tokenOptions).firestore();
    }
    return testEnv.unauthenticatedContext().firestore();
  }

  // ---- 1. User Profiles (/users/{userId}) ----
  describe('User Profiles', () => {
    it('allows an unauthenticated user to read nothing', async () => {
      const db = getDb(null);
      const userRef = doc(db, 'users/patient_1');
      await assertFails(getDoc(userRef));
    });

    it('allows patients to read their own profiles, but not other patient profiles', async () => {
      const db1 = getDb({ uid: 'patient_1' });
      const db2 = getDb({ uid: 'patient_2' });

      // Seed profiles
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();
        await setDoc(doc(adminDb, 'users/patient_1'), { uid: 'patient_1', role: 'patient', displayName: 'Patient One' });
        await setDoc(doc(adminDb, 'users/patient_2'), { uid: 'patient_2', role: 'patient', displayName: 'Patient Two' });
      });

      // Can read own
      await assertSucceeds(getDoc(doc(db1, 'users/patient_1')));
      // Cannot read other patient
      await assertFails(getDoc(doc(db1, 'users/patient_2')));
    });

    it('allows patients to read verified/unverified doctor profiles', async () => {
      const db = getDb({ uid: 'patient_1' });

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();
        await setDoc(doc(adminDb, 'users/doctor_1'), { uid: 'doctor_1', role: 'doctor', verified: true, displayName: 'Dr. Smith' });
      });

      await assertSucceeds(getDoc(doc(db, 'users/doctor_1')));
    });

    it('prevents users from registering with role "admin"', async () => {
      const db = getDb({ uid: 'hacker_1' });
      const userRef = doc(db, 'users/hacker_1');

      await assertFails(setDoc(userRef, {
        uid: 'hacker_1',
        role: 'admin',
        displayName: 'Hacker'
      }));
    });

    it('allows registering a patient profile with verified: false or omitted', async () => {
      const db = getDb({ uid: 'patient_1' });
      const userRef = doc(db, 'users/patient_1');

      await assertSucceeds(setDoc(userRef, {
        uid: 'patient_1',
        role: 'patient',
        displayName: 'New Patient'
      }));
    });

    it('prevents registering a verified doctor profile directly (must start unverified)', async () => {
      const db = getDb({ uid: 'doctor_1' });
      const userRef = doc(db, 'users/doctor_1');

      await assertFails(setDoc(userRef, {
        uid: 'doctor_1',
        role: 'doctor',
        verified: true,
        displayName: 'Dr. Fraud'
      }));
    });
  });

  // ---- 2. Consent Gating (/mood_entries, /journals, etc.) ----
  describe('Consent Gating & Clinical Records', () => {
    beforeEach(async () => {
      // Seed Patient & Doctor Profiles
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();
        await setDoc(doc(adminDb, 'users/patient_1'), { uid: 'patient_1', role: 'patient' });
        await setDoc(doc(adminDb, 'users/doctor_1'), { uid: 'doctor_1', role: 'doctor', verified: true });
      });
    });

    it('allows a patient to read and write their own mood entries', async () => {
      const db = getDb({ uid: 'patient_1' });
      const entryRef = doc(db, 'mood_entries/entry_1');

      await assertSucceeds(setDoc(entryRef, {
        patientId: 'patient_1',
        dominantEmotion: 'Happy',
        confidence: 0.95,
        timestamp: new Date().toISOString()
      }));

      await assertSucceeds(getDoc(entryRef));
    });

    it('prevents a patient from reading or writing another patient\'s mood entries', async () => {
      const db2 = getDb({ uid: 'patient_2' });

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();
        await setDoc(doc(adminDb, 'mood_entries/entry_1'), {
          patientId: 'patient_1',
          dominantEmotion: 'Sad',
          confidence: 0.8
        });
      });

      await assertFails(getDoc(doc(db2, 'mood_entries/entry_1')));
      await assertFails(setDoc(doc(db2, 'mood_entries/entry_1'), {
        patientId: 'patient_1',
        dominantEmotion: 'Sad',
        confidence: 0.8
      }));
    });

    it('GUARANTEES that a doctor cannot read patient mood entries or journals directly from Firestore', async () => {
      // This is the core HIPAA/GDPR validation test.
      // Even if the doctor is attending the patient, client-side queries MUST be blocked
      // forcing the doctor to query the backend API which inspects the shareConsent toggle.
      const doctorDb = getDb({ uid: 'doctor_1' });

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();
        await setDoc(doc(adminDb, 'mood_entries/entry_1'), {
          patientId: 'patient_1',
          dominantEmotion: 'Neutral',
          confidence: 0.7
        });
        await setDoc(doc(adminDb, 'journals/journal_1'), {
          patientId: 'patient_1',
          text: 'Private thoughts',
          timestamp: new Date().toISOString()
        });
      });

      // Gated at DB level: Doctor direct reads MUST fail
      await assertFails(getDoc(doc(doctorDb, 'mood_entries/entry_1')));
      await assertFails(getDoc(doc(doctorDb, 'journals/journal_1')));
    });
  });

  // ---- 3. Appointments (/appointments/{appointmentId}) ----
  describe('Appointments', () => {
    beforeEach(async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();
        await setDoc(doc(adminDb, 'users/patient_1'), { uid: 'patient_1', role: 'patient' });
        await setDoc(doc(adminDb, 'users/doctor_1'), { uid: 'doctor_1', role: 'doctor', verified: true });
        await setDoc(doc(adminDb, 'users/patient_2'), { uid: 'patient_2', role: 'patient' });
      });
    });

    it('allows a patient to book an appointment with "pending" status', async () => {
      const db = getDb({ uid: 'patient_1' });
      const apptRef = doc(db, 'appointments/appt_1');

      await assertSucceeds(setDoc(apptRef, {
        patientId: 'patient_1',
        doctorId: 'doctor_1',
        status: 'pending',
        timestamp: new Date().toISOString()
      }));
    });

    it('prevents a patient from booking an appointment with "approved" status directly', async () => {
      const db = getDb({ uid: 'patient_1' });
      const apptRef = doc(db, 'appointments/appt_1');

      await assertFails(setDoc(apptRef, {
        patientId: 'patient_1',
        doctorId: 'doctor_1',
        status: 'approved',
        timestamp: new Date().toISOString()
      }));
    });

    it('allows a doctor in the appointment to update it (e.g. approve/complete it)', async () => {
      const doctorDb = getDb({ uid: 'doctor_1' });
      const apptRef = doc(doctorDb, 'appointments/appt_1');

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();
        await setDoc(doc(adminDb, 'appointments/appt_1'), {
          patientId: 'patient_1',
          doctorId: 'doctor_1',
          status: 'pending'
        });
      });

      await assertSucceeds(updateDoc(apptRef, {
        status: 'approved'
      }));
    });

    it('prevents outside users from reading the appointment details', async () => {
      const db2 = getDb({ uid: 'patient_2' }); // Patient 2 is not part of the appointment
      const apptRef = doc(db2, 'appointments/appt_1');

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();
        await setDoc(doc(adminDb, 'appointments/appt_1'), {
          patientId: 'patient_1',
          doctorId: 'doctor_1',
          status: 'completed'
        });
      });

      await assertFails(getDoc(apptRef));
    });
  });

  // ---- 4. Audits & Broadcasts ----
  describe('Audits & System Broadcasts', () => {
    it('prevents any client from writing directly to the consent_audit logs', async () => {
      const db = getDb({ uid: 'patient_1' });
      const auditRef = doc(db, 'consent_audit/audit_1');

      await assertFails(setDoc(auditRef, {
        patientId: 'patient_1',
        doctorId: 'doctor_1',
        accessedAt: new Date().toISOString(),
        action: 'read_summary'
      }));
    });

    it('prevents clients from writing system broadcasts', async () => {
      const db = getDb({ uid: 'admin_1', tokenOptions: { role: 'admin' } }); // even admin user auth context
      const broadcastRef = doc(db, 'broadcasts/alert_1');

      // Writes are write: false for all clients (done via Admin SDK on backend)
      await assertFails(setDoc(broadcastRef, {
        message: 'System Maintenance',
        active: true
      }));
    });
  });

  // ---- 5. Notifications (/notifications/{notifId}) ----
  describe('Notifications', () => {
    it('allows a user to create a notification addressed to themselves', async () => {
      const db = getDb({ uid: 'patient_1' });
      const notifRef = doc(db, 'notifications/notif_1');
      await assertSucceeds(setDoc(notifRef, {
        userId: 'patient_1',
        type: 'habit_reminder',
        title: 'Habit Reminder',
        read: false,
        ts: Date.now()
      }));
    });

    it('prevents a user from creating a notification addressed to someone else', async () => {
      const db = getDb({ uid: 'patient_1' });
      const notifRef = doc(db, 'notifications/notif_2');
      await assertFails(setDoc(notifRef, {
        userId: 'patient_2',
        type: 'habit_reminder',
        title: 'Habit Reminder',
        read: false,
        ts: Date.now()
      }));
    });

    it('allows a user to read their own notifications', async () => {
      const db = getDb({ uid: 'patient_1' });
      const notifRef = doc(db, 'notifications/notif_1');
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();
        await setDoc(doc(adminDb, 'notifications/notif_1'), {
          userId: 'patient_1',
          type: 'habit_reminder',
          read: false
        });
      });
      await assertSucceeds(getDoc(notifRef));
    });

    it('prevents a user from reading another user\'s notifications', async () => {
      const db = getDb({ uid: 'patient_2' });
      const notifRef = doc(db, 'notifications/notif_1');
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();
        await setDoc(doc(adminDb, 'notifications/notif_1'), {
          userId: 'patient_1',
          type: 'habit_reminder',
          read: false
        });
      });
      await assertFails(getDoc(notifRef));
    });

    it('allows a user to update only the read and readAt fields of their own notification', async () => {
      const db = getDb({ uid: 'patient_1' });
      const notifRef = doc(db, 'notifications/notif_1');
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();
        await setDoc(doc(adminDb, 'notifications/notif_1'), {
          userId: 'patient_1',
          type: 'habit_reminder',
          read: false,
          ts: 1000
        });
      });

      // Update read and readAt
      await assertSucceeds(updateDoc(notifRef, {
        read: true,
        readAt: Date.now()
      }));
    });

    it('prevents a user from updating fields other than read/readAt of their own notification', async () => {
      const db = getDb({ uid: 'patient_1' });
      const notifRef = doc(db, 'notifications/notif_1');
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();
        await setDoc(doc(adminDb, 'notifications/notif_1'), {
          userId: 'patient_1',
          type: 'habit_reminder',
          read: false,
          ts: 1000
        });
      });

      // Update ts
      await assertFails(updateDoc(notifRef, {
        ts: Date.now()
      }));

      // Update details
      await assertFails(updateDoc(notifRef, {
        title: 'New Title'
      }));
    });
  });
});
