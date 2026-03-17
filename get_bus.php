<?php
// ============================================================
// get_bus.php — AJAX GET: return one bus location as JSON
// Public endpoint. No session required.
// ============================================================
require_once 'config.php';

header('Content-Type: application/json');
header('Cache-Control: no-store');

$bus_id = filter_input(INPUT_GET, 'bus_id', FILTER_VALIDATE_INT);
if (!$bus_id || $bus_id <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid bus_id']);
    exit;
}

$conn = getDBConnection();
$stmt = $conn->prepare(
    'SELECT bus_id, bus_name, route, latitude, longitude, last_updated, is_active
       FROM buses WHERE bus_id = ?'
);
$stmt->bind_param('i', $bus_id);
$stmt->execute();
$result = $stmt->get_result();
$bus    = $result->fetch_assoc();
$stmt->close();
$conn->close();

if (!$bus) {
    http_response_code(404);
    echo json_encode(['error' => 'Bus not found']);
    exit;
}

// Cast types for JSON
$bus['bus_id']    = (int)$bus['bus_id'];
$bus['latitude']  = (float)$bus['latitude'];
$bus['longitude'] = (float)$bus['longitude'];
$bus['is_active'] = (int)$bus['is_active'];

echo json_encode($bus);
