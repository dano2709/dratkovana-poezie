FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY . .
RUN mkdir -p uploads data && npm run build
EXPOSE 3001
CMD ["npm", "start"]
