#!/bin/bash
# ==============================================================================
# HelpMeLearn - Azure App Service Free F1 Tier Deployment Script
# ==============================================================================

# Variables
RESOURCE_GROUP="rg-helpmelearn-free"
LOCATION="eastus"
APP_PLAN="plan-helpmelearn-free"
APP_NAME="helpmelearn-app-$RANDOM"
RUNTIME="NODE:20-lts"

echo "🚀 Starting Azure Free Tier Deployment for HelpMeLearn..."

# 1. Login check
az account show > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "🔑 Logging into Azure..."
  az login
fi

# 2. Create Resource Group
echo "📁 Creating Resource Group '$RESOURCE_GROUP' in '$LOCATION'..."
az group create --name $RESOURCE_GROUP --location $LOCATION

# 3. Create Free F1 App Service Plan
echo "⚡ Creating Free Tier App Service Plan '$APP_PLAN' (SKU: FREE F1)..."
az appservice plan create \
  --name $APP_PLAN \
  --resource-group $RESOURCE_GROUP \
  --sku F1 \
  --is-linux

# 4. Create Web App
echo "🌐 Creating Web App '$APP_NAME'..."
az webapp create \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --plan $APP_PLAN \
  --runtime $RUNTIME

# 5. Configure Deployment Zip
echo "📦 Packaging application files..."
zip -r deploy.zip . -x "node_modules/*" ".git/*" "data/*.db" "uploads/*"

# 6. Deploy Zip to Azure
echo "☁️ Deploying to Azure Web App '$APP_NAME'..."
az webapp deployment source config-zip \
  --resource-group $RESOURCE_GROUP \
  --name $APP_NAME \
  --src deploy.zip

# Clean up zip
rm deploy.zip

echo "================================================================="
echo "🎉 DEPLOYMENT COMPLETE!"
echo "🔗 Access your app live on Azure: https://$APP_NAME.azurewebsites.net"
echo "================================================================="
