function subscribeToBus(busId, tripType) {
  supabase.channel(`bus-${busId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'computed_locations',
      filter: `bus_id=eq.${busId}`
    }, (payload) => {
      const { latitude, longitude } = payload.new;
      updateBusMarker(latitude, longitude);
      const chartPos = computeChartPosition(latitude, longitude, tripType);
      updateChartMarker(chartPos);
    })
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'stop_arrivals',
      filter: `trip_id=eq.${localStorage.getItem('activeTripId')}`
    }, (payload) => {
      markStopVisited(payload.new.stop_index);
    })
    .subscribe();
}

window.subscribeToBus = subscribeToBus;
