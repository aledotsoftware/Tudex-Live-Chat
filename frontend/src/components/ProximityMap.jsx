import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export function ProximityMap({ currentUser, users, onSelectUser, onToggleFollow }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersGroupRef = useRef(null);

  const centerLat = currentUser?.latitude || 40.4167;
  const centerLng = currentUser?.longitude || -3.7037;

  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [centerLat, centerLng],
        zoom: 13,
        zoomControl: false
      });

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      // Dark CartoDB tile layer for modern aesthetics
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
      }).addTo(map);

      markersGroupRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    } else {
      mapInstanceRef.current.setView([centerLat, centerLng], mapInstanceRef.current.getZoom());
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapInstanceRef.current || !markersGroupRef.current) return;

    markersGroupRef.current.clearLayers();

    // 1. Current user marker
    const meLat = currentUser?.latitude || centerLat;
    const meLng = currentUser?.longitude || centerLng;
    const meIcon = L.divIcon({
      className: 'custom-map-marker-me',
      html: `
        <div style="
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: linear-gradient(135deg, #a855f7 0%, #6366f1 100%);
          border: 3px solid #ffffff;
          box-shadow: 0 0 20px rgba(168, 85, 247, 0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 800;
          font-size: 14px;
        ">
          Tú
        </div>
      `,
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });

    const meMarker = L.marker([meLat, meLng], { icon: meIcon }).addTo(markersGroupRef.current);
    meMarker.bindPopup(`
      <div style="text-align: center; padding: 6px; color: #fff;">
        <strong style="color: #a855f7;">Tu Ubicación Actual</strong>
        <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Punto central de búsqueda en la red</div>
      </div>
    `);

    // 2. Nearby users markers
    users.forEach((user, index) => {
      // Offset coordinates if not present or identical
      const lat = user.latitude || (meLat + (Math.sin(index + 1) * 0.012));
      const lng = user.longitude || (meLng + (Math.cos(index + 1) * 0.012));
      const initial = (user.username || 'U').substring(0, 2).toUpperCase();
      const isOnline = user.status === 'online';

      const userIcon = L.divIcon({
        className: `custom-map-marker-user-${user._id}`,
        html: `
          <div style="
            position: relative;
            width: 42px;
            height: 42px;
            border-radius: 50%;
            background: ${user.avatarUrl ? 'transparent' : (user.avatarColor || 'linear-gradient(135deg, #a855f7, #6366f1)')};
            border: 2px solid rgba(255, 255, 255, 0.9);
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            color: #ffffff;
            font-weight: 700;
            font-size: 13px;
            overflow: hidden;
            cursor: pointer;
          ">
            ${user.avatarUrl ? `<img src="${user.avatarUrl}" style="width:100%;height:100%;object-fit:cover;" />` : initial}
            <span style="
              position: absolute;
              bottom: 1px;
              right: 1px;
              width: 10px;
              height: 10px;
              border-radius: 50%;
              background: ${isOnline ? '#10b981' : '#64748b'};
              border: 1.5px solid #0b0f17;
            "></span>
          </div>
        `,
        iconSize: [42, 42],
        iconAnchor: [21, 21]
      });

      const marker = L.marker([lat, lng], { icon: userIcon }).addTo(markersGroupRef.current);

      const distanceText = user.distanceMeters
        ? (user.distanceMeters < 1000 ? `${user.distanceMeters} m` : `${(user.distanceMeters / 1000).toFixed(1)} km`)
        : '150 m';

      const popupNode = document.createElement('div');
      popupNode.style.padding = '8px';
      popupNode.style.textAlign = 'center';
      popupNode.style.minWidth = '160px';
      popupNode.innerHTML = `
        <div style="font-weight: 700; font-size: 15px; color: #fff;">${user.username}</div>
        <div style="font-size: 12px; color: #94a3b8; margin: 4px 0 8px 0;">${user.bio || '¡Hola! Estoy usando Tudex Social.'}</div>
        <div style="font-size: 11px; background: rgba(168, 85, 247, 0.2); color: #c084fc; padding: 2px 8px; border-radius: 12px; display: inline-block; margin-bottom: 10px; font-weight: 600;">
          📍 a ${distanceText}
        </div>
        <div style="display: flex; gap: 6px; justify-content: center;">
          <button id="chat-btn-${user._id}" style="
            padding: 6px 12px;
            border-radius: 8px;
            border: none;
            background: linear-gradient(135deg, #a855f7, #6366f1);
            color: white;
            font-weight: 600;
            font-size: 12px;
            cursor: pointer;
          ">Chatear</button>
          <button id="follow-btn-${user._id}" style="
            padding: 6px 12px;
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            background: rgba(255, 255, 255, 0.08);
            color: white;
            font-weight: 600;
            font-size: 12px;
            cursor: pointer;
          ">${user.isFollowed ? 'Siguiendo' : 'Seguir'}</button>
        </div>
      `;

      marker.bindPopup(popupNode);

      marker.on('popupopen', () => {
        const chatBtn = document.getElementById(`chat-btn-${user._id}`);
        const followBtn = document.getElementById(`follow-btn-${user._id}`);
        if (chatBtn) {
          chatBtn.onclick = () => onSelectUser(user);
        }
        if (followBtn) {
          followBtn.onclick = () => onToggleFollow(user._id, user.isFollowed);
        }
      });
    });
  }, [users, currentUser]);

  return (
    <div style={{ width: '100%', height: '100%', minHeight: '380px', borderRadius: '18px', overflow: 'hidden', position: 'relative' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%', minHeight: '380px' }} />
      <div style={{
        position: 'absolute',
        top: '12px',
        left: '12px',
        zIndex: 1000,
        background: 'rgba(11, 15, 23, 0.85)',
        backdropFilter: 'blur(12px)',
        padding: '6px 12px',
        borderRadius: '12px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        fontSize: '0.8rem',
        fontWeight: '600',
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        gap: '6px'
      }}>
        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#a855f7', boxShadow: '0 0 8px #a855f7' }}></span>
        <span>Mapa Interactivo de Red Social</span>
      </div>
    </div>
  );
}
