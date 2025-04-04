document.addEventListener("DOMContentLoaded", function () {
    const chatInput = document.getElementById("chat-input");
    const sendButton = document.getElementById("send-button");
    const chatBox = document.getElementById("chat-box");

    async function sendMessage() {
        const userMessage = chatInput.value.trim();
        if (!userMessage) return;

        // Add user message to chat
        appendMessage("user", userMessage);
        chatInput.value = "";

        try {
            // Show loading message
            const loadingId = appendMessage("bot", "Thinking...");

            const response = await fetch("http://127.0.0.1:5000/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ message: userMessage })
            });

            if (!response.ok) {
                throw new Error("Server response was not ok");
            }

            const data = await response.json();

            // Remove loading message and add bot response
            const loadingMessage = document.getElementById(loadingId);
            if (loadingMessage) chatBox.removeChild(loadingMessage);
            appendMessage("bot", data.response);
        } catch (error) {
            console.error("Error:", error);
            appendMessage("bot", "Sorry, I'm having trouble connecting. Please try again.");
        }
    }

    function appendMessage(sender, message) {
        const messageDiv = document.createElement("div");
        const messageId = `msg-${Date.now()}`;
        messageDiv.id = messageId;
        messageDiv.classList.add(sender === "user" ? "user-message" : "bot-message");
        messageDiv.textContent = message;
        chatBox.appendChild(messageDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
        return messageId;
    }

    // Send message on button click
    sendButton.addEventListener("click", sendMessage);

    // Send message on Enter key
    chatInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            sendMessage();
        }
    });

    // Hide all pages except home on load
    document.querySelectorAll(".page").forEach(page => {
        page.style.display = "none";
    });
    document.querySelector("#home").style.display = "block";

    // Handle navigation clicks
    document.querySelectorAll(".nav-link").forEach(link => {
        link.addEventListener("click", function (e) {
            e.preventDefault();

            document.querySelectorAll(".page").forEach(page => {
                page.style.display = "none";
            });

            const target = document.querySelector(this.getAttribute("href"));
            if (target) {
                target.style.display = "block";
            }
        });
    });

    // Chatbot Navigation
    document.querySelectorAll(".chat-button").forEach(chatButton => {
        chatButton.addEventListener("click", function (e) {
            e.preventDefault();
            document.querySelectorAll(".page").forEach(page => {
                page.style.display = "none";
            });
            document.querySelector("#chatbot").style.display = "block";
        });
    });

    // Chatbot Fetch API Integration
    document.getElementById("send-btn").addEventListener("click", async function() {
        let userMessage = document.getElementById("message-input").value.trim();

        if (!userMessage) return;

        let chatBox = document.getElementById("chat-box");
        chatBox.innerHTML += `<p><strong>You:</strong> ${userMessage}</p>`;

        document.getElementById("message-input").value = "";

        // Show "Thinking..." message
        chatBox.innerHTML += `<p><strong>AI:</strong> Thinking...</p>`;

        try {
            let response = await fetch("http://127.0.0.1:5000/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: userMessage })
            });

            let data = await response.json();

            if (data.response) {
                chatBox.innerHTML += `<p><strong>AI:</strong> ${data.response}</p>`;
            } else {
                chatBox.innerHTML += `<p><strong>AI:</strong> Sorry, I couldn't generate a response.</p>`;
            }

        } catch (error) {
            chatBox.innerHTML += `<p><strong>AI:</strong> Error: ${error.message}</p>`;
        }
    });

    // Meditation Timer
    let timer;
    let timeLeft = 300; // 5 minutes
    const timerDisplay = document.getElementById("timer");
    const startButton = document.getElementById("start-timer");
    const pauseButton = document.getElementById("pause-timer");
    const resetButton = document.getElementById("reset-timer");

    function updateTimerDisplay() {
        let minutes = Math.floor(timeLeft / 60);
        let seconds = timeLeft % 60;
        timerDisplay.textContent = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    }

    function startTimer() {
        if (!timer) {
            timer = setInterval(() => {
                if (timeLeft > 0) {
                    timeLeft--;
                    updateTimerDisplay();
                } else {
                    clearInterval(timer);
                    timer = null;
                }
            }, 1000);
        }
    }

    function pauseTimer() {
        clearInterval(timer);
        timer = null;
    }

    function resetTimer() {
        clearInterval(timer);
        timer = null;
        timeLeft = 300;
        updateTimerDisplay();
    }

    if (startButton) startButton.addEventListener("click", startTimer);
    if (pauseButton) pauseButton.addEventListener("click", pauseTimer);
    if (resetButton) resetButton.addEventListener("click", resetTimer);
    updateTimerDisplay();

    // Meditation Sound Selection
    let soundPlayer = new Audio();

    function playSound(type) {
        const sounds = {
            ocean: "sounds/ocean.mp3",
            rain: "sounds/rain.mp3",
            birds: "sounds/birds.mp3"
        };

        if (sounds[type]) {
            soundPlayer.pause();
            soundPlayer.src = sounds[type];
            soundPlayer.loop = true;
            soundPlayer.play();
        }
    }

    function stopSound() {
        soundPlayer.pause();
        soundPlayer.currentTime = 0;
    }

    document.querySelectorAll(".sound-button").forEach(button => {
        button.addEventListener("click", () => playSound(button.dataset.sound));
    });

    const stopSoundButton = document.getElementById("stop-sound");
    if (stopSoundButton) stopSoundButton.addEventListener("click", stopSound);
});

// Emotion Recognition
document.addEventListener("DOMContentLoaded", () => {
    const video = document.getElementById("video");
    const canvas = document.getElementById("canvas");
    const startCameraBtn = document.getElementById("start-camera");
    const endCameraBtn = document.getElementById("end-camera");
    const emotionResult = document.getElementById("emotion-result");
    const happyPercentage = document.getElementById("happy-percentage");
    const sadPercentage = document.getElementById("sad-percentage");
    const angryPercentage = document.getElementById("angry-percentage");
    let stream;

    startCameraBtn.addEventListener("click", async () => {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
            video.srcObject = stream;
            video.style.display = "block";
            canvas.style.display = "block";
            startCameraBtn.style.display = "none";
            endCameraBtn.style.display = "block";
            emotionResult.textContent = "Analyzing...";
            startEmotionAnalysis();
        } catch (error) {
            console.error("Error accessing camera:", error);
            emotionResult.textContent = "Camera access denied or unavailable.";
        }
    });

    endCameraBtn.addEventListener("click", () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            video.srcObject = null;
            video.style.display = "none";
            canvas.style.display = "none";
            startCameraBtn.style.display = "block";
            endCameraBtn.style.display = "none";
            emotionResult.textContent = "Not started";
            happyPercentage.textContent = "0%";
            sadPercentage.textContent = "0%";
            angryPercentage.textContent = "0%";
        }
    });

    function startEmotionAnalysis() {
        setInterval(() => {
            const emotions = ["Happy", "Sad", "Angry"];
            const randomEmotion = emotions[Math.floor(Math.random() * emotions.length)];
            emotionResult.textContent = randomEmotion;

            happyPercentage.textContent = `${Math.floor(Math.random() * 100)}%`;
            sadPercentage.textContent = `${Math.floor(Math.random() * 100)}%`;
            angryPercentage.textContent = `${Math.floor(Math.random() * 100)}%`;
        }, 3000);
    }
});

// Page Navigation
document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".nav-link").forEach(link => {
        link.addEventListener("click", (e) => {
            e.preventDefault();
            document.querySelectorAll(".page").forEach(page => {
                page.style.display = "none";
            });
            document.querySelector(link.getAttribute("href")).style.display = "block";
        });
    });

    document.querySelectorAll(".chat-button").forEach(button => {
        button.addEventListener("click", (e) => {
            e.preventDefault();
            document.querySelectorAll(".page").forEach(page => {
                page.style.display = "none";
            });
            document.querySelector("#chatbot").style.display = "block";
        });
    });

    // Show home page by default
    document.querySelector("#home").style.display = "block";
});
