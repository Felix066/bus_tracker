🚌 BusTrack – Enterprise-Grade College Transportation Management Platform

«A real-time smart transportation platform designed to improve campus mobility through live vehicle tracking, secure role-based access control, route intelligence, and operational visibility.»

"Status" (https://img.shields.io/badge/Status-Production%20Ready-success)
"Platform" (https://img.shields.io/badge/Platform-Web%20%2B%20PWA-blue)
"Backend" (https://img.shields.io/badge/Backend-Node.js-green)
"Database" (https://img.shields.io/badge/Database-Supabase-orange)
"Security" (https://img.shields.io/badge/Security-RLS%20%2B%20JWT-red)

---

🚀 Overview

BusTrack is a full-stack transportation management solution developed to modernize college bus operations through real-time location tracking, secure authentication, route monitoring, and centralized administration.

The platform enables students to monitor bus locations live, drivers to share trip updates seamlessly, and administrators to supervise the entire transportation ecosystem through a dedicated control panel.

Unlike traditional GPS demos, BusTrack incorporates location filtering, security policies, synchronization mechanisms, and scalable cloud architecture suitable for real-world deployment.

---

✨ Key Features

👨‍🎓 Student Portal

- Live bus tracking on interactive maps
- Real-time location updates
- Driver information display
- Route visualization
- ETA estimation support
- Mobile-friendly interface
- Location awareness without transmitting student GPS data

---

🚍 Driver Portal

- Secure driver authentication
- Trip initiation and completion controls
- Live location broadcasting
- Route progress tracking
- Driver session management
- Real-time synchronization with student dashboards

---

🛡️ Admin Dashboard

- Transportation system monitoring
- Driver management
- Bus allocation management
- SOS monitoring interface
- Active trip supervision
- User administration
- System-level analytics support

---

🔒 Security Architecture

Security was treated as a first-class design principle.

Implemented Controls

- JWT Authentication
- Password Hashing using Bcrypt
- Supabase Row Level Security (RLS)
- Session Protection
- Role-Based Access Control (RBAC)
- API Rate Limiting
- Helmet Security Middleware
- Protected Administrative Routes

This architecture ensures users can only access data relevant to their assigned role.

---

📍 Real-Time Tracking Engine

The tracking subsystem is designed to provide smoother and more reliable vehicle positioning.

Technologies Used

- GPS Location Services
- Supabase Realtime
- WebSocket-based Synchronization
- Kalman Filter Position Smoothing
- Location Update Optimization
- Route Mapping

Why It Matters

Raw GPS coordinates often fluctuate due to signal noise.

To improve location accuracy and user experience, a Kalman Filter was implemented to smooth incoming coordinates before displaying them on the map.

---

🏗️ System Architecture

Frontend

- HTML5
- CSS3
- JavaScript (ES6)

Backend

- Node.js
- Express.js

Database & Cloud

- Supabase
- Realtime Database
- Authentication Services

Mapping

- OpenStreetMap
- Leaflet.js

Security

- JWT
- Bcrypt
- Helmet
- Rate Limiter
- RLS Policies

---

📱 Progressive Web Application (PWA)

BusTrack is designed as a Progressive Web App.

Benefits include:

- Installable on mobile devices
- Fast loading experience
- App-like user interface
- Improved accessibility for students and staff

---

⚡ Performance Optimizations

Implemented several optimizations to ensure scalability and responsiveness:

- Realtime data synchronization
- Efficient location update handling
- Reduced unnecessary GPS transmissions
- Session-based state management
- Optimized database queries
- Location smoothing algorithms

---

🎯 Engineering Challenges Solved

Problem 1

Inaccurate GPS coordinates causing location jumps.

Solution

Implemented Kalman Filtering for smoother tracking.

---

Problem 2

Unauthorized access to transportation data.

Solution

Implemented JWT authentication and Row Level Security.

---

Problem 3

Scalability of live location updates.

Solution

Used Supabase Realtime architecture and optimized synchronization logic.

---

📂 Project Structure

BusTrack
│
├── Student Portal
├── Driver Portal
├── Admin Dashboard
├── Backend API
├── Realtime Synchronization Layer
├── GPS Processing Module
├── Route Management System
├── Authentication Module
├── Security Policies
└── PWA Support

---

💡 What I Learned

Through this project I gained practical experience in:

- Full-Stack Development
- Realtime Systems
- Cloud Databases
- Authentication & Authorization
- Security Engineering
- Location-Based Services
- System Architecture Design
- Production-Oriented Application Development

---

👨‍💻 Developer

Felix Danie Jose

B.Tech – Artificial Intelligence & Machine Learning

Areas of Interest:

- Artificial Intelligence
- Machine Learning
- Full-Stack Development
- Realtime Systems
- Cloud Applications

---

«Building technology that solves real-world operational challenges through intelligent, secure, and scalable software systems.»
<img width="1401" height="857" alt="image" src="https://github.com/user-attachments/assets/12860509-87c1-4d91-81a8-50c3cc1a92ae" />

<img width="1432" height="862" alt="image" src="https://github.com/user-attachments/assets/bf7d3cd5-6280-482d-b4aa-f8a453f68982" />
<img width="1912" height="952" alt="image" src="https://github.com/user-attachments/assets/e2755a22-476a-4dd9-b6d9-19740a0f525b" />
<img width="1906" height="915" alt="image" src="https://github.com/user-attachments/assets/049f9cd0-ceda-42d4-8d1e-86d35904674e" />

<img width="1911" height="902" alt="image" src="https://github.com/user-attachments/assets/952c1c50-d6e3-4f33-a6eb-eb091e1f8f8b" />
<img width="1266" height="911" alt="image" src="https://github.com/user-attachments/assets/0de37ed2-3417-40ae-96d8-8ffa79433c56" />



