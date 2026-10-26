# Пример API

Ответ получен при локальном запуске с отдельной БД в памяти.

```http
GET /api/sounds/1 HTTP/1.1
Host: localhost:4700
```

HTTP 200

```json
{
  "id": 1,
  "title": "Утро на Яузе",
  "city": "Москва",
  "district": "Басманный",
  "mood": "calm",
  "lat": 55.759,
  "lng": 37.665,
  "duration": 189,
  "color": "#9fc7bd",
  "description": "Звуковая сцена у реки: непрерывный плеск и шум водного потока.",
  "frequency": 174,
  "texture": "water",
  "recorded_at": "2026-06-12T05:42:00",
  "audio_url": "audio/1.mp3",
  "source_url": "https://freesound.org/people/Fabrizio84/sounds/457960/",
  "license": "CC0-1.0",
  "notes": [
    {
      "id": 1,
      "sound_id": 1,
      "author": "Марина",
      "note": "Лучше слушать в наушниках: справа появляется звон велосипеда.",
      "created_at": "2026-06-13T10:00:00"
    }
  ]
}
```
