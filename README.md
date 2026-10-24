# EchoMap — интерактивный атлас звуков

Соединяет карту, фильтрацию звуков и процедурное аудиопревью.

**Проект:** Самостоятельная разработка.

![CI](https://github.com/memorim/echomap-sound-atlas/actions/workflows/ci.yml/badge.svg)

![Компьютерная версия](docs/desktop.png)

<img src="docs/mobile.png" width="320" alt="Мобильная версия">

[Короткая демонстрация сценария](docs/demo.gif)

## Что работает
- Карта, выбор города и атмосферы, карточки записей.
- Процедурное воспроизведение через Web Audio API.
- REST API каталога, статистики и заметок.

## Стек
JavaScript, Web Audio API, Express, SQLite, Zod, HTML, CSS.

## Запуск и проверка
Node.js 24.18.0 и pnpm 11.7.0.

```bash
npm install --global pnpm@11.7.0
pnpm install --frozen-lockfile
pnpm test
pnpm start
```

## Технические решения
- Для карты не используется сторонний SDK.
- Аудиопревью синтезируется в браузере из параметров записи.

## Проверка интерфейса

Playwright проверяет компьютерную и мобильную версии, отсутствие горизонтального прокручивания и повтор загрузки после ответа API 503. Ошибка отправки формы сохраняет введённые данные.

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

## Подробности
[API, конфигурация и исходные инструкции](docs/TECHNICAL.md).

[Результаты проверки этой версии](docs/VERIFICATION.md).

[Пример запроса и ответа API](docs/API_EXAMPLE.md).

## Проверки и обновления
CI проверяет проект и ссылки на локальные материалы. Dependabot предлагает обновления зависимостей и Actions. [История изменений](CHANGELOG.md).

[Контракты API и обновление базы](docs/COMPATIBILITY.md): `pnpm test:contract && pnpm test:upgrade`.
