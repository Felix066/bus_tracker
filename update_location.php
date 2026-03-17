<?php
// ============================================================
// update_location.php — AJAX POST: receive driver GPS, update DB
// ============================================================
require_once 'config.php';

header('Content-Type: application/json');

// Auth check
if (empty($_SESSION['role']) || $_SESSION['role'] !== 'driver') {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

$bus_id = (int)($_SESSION['bus_id'] ?? 0);
if ($bus_id <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'No bus assigned to this driver.']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);

// ── Stop broadcasting ──
if (isset($input['is_active']) && $input['is_active'] === 0) {
    $conn = getDBConnection();
    $stmt = $conn->prepare('UPDATE buses SET is_active = 0 WHERE bus_id = ?');
    $stmt->bind_param('i', $bus_id);
    $stmt->execute();
    $stmt->close();
    $conn->close();
    echo json_encode(['status' => 'ok']);
    exit;
}

// ── Update position ──
$lat = $input['latitude']  ?? null;
$lng = $input['longitude'] ?? null;

if (!is_numeric($lat) || !is_numeric($lng)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid coordinates']);
    exit;
}

$lat = (float)$lat;
$lng = (float)$lng;

if ($lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid coordinates']);
    exit;
}

$conn = getDBConnection();

// Update buses table
$stmt = $conn->prepare(
    'UPDATE buses SET latitude = ?, longitude = ?, last_updated = CURRENT_TIMESTAMP, is_active = 1 WHERE bus_id = ?'
);
$stmt->bind_param('ddi', $lat, $lng, $bus_id);
$stmt->execute();
$stmt->close();

// Insert into location_history
$stmt2 = $conn->prepare(
    'INSERT INTO location_history (bus_id, latitude, longitude) VALUES (?, ?, ?)'
);
$stmt2->bind_param('idd', $bus_id, $lat, $lng);
$stmt2->execute();
$stmt2->close();

$conn->close();

echo json_encode([
    'status'    => 'ok',
    'timestamp' => date('Y-m-d H:i:s'),
]);
