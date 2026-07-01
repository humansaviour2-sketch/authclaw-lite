FROM python:3.14-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
RUN addgroup --system authclaw && adduser --system --ingroup authclaw authclaw

COPY --chown=authclaw:authclaw . .

EXPOSE 9108

USER authclaw

CMD ["python", "consumer.py"]
