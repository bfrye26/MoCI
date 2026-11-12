include $(TOPDIR)/rules.mk
PKG_NAME:=moci-app-docker
PKG_VERSION:=0.10.0
PKG_RELEASE:=6
PKG_LICENSE:=MIT
PKG_MAINTAINER:=MoCI contributors
include $(INCLUDE_DIR)/package.mk

define Package/moci-app-docker
  SECTION:=admin
  CATEGORY:=Administration
  SUBMENU:=MoCI Add-ons
  TITLE:=Native Docker and Homelab Applications for MoCI
  PKGARCH:=all
  DEPENDS:=+moci +dockerd +docker-compose +python3-light +python3-email +python3-urllib
endef

define Build/Compile
endef

define Package/moci-app-docker/install
	$(INSTALL_DIR) $(1)/www/moci/js/addons/docker
	$(INSTALL_DATA) ./files/manifest.json $(1)/www/moci/js/addons/docker/manifest.json
	$(INSTALL_DATA) ./files/addon.js $(1)/www/moci/js/addons/docker/addon.js
	$(INSTALL_DATA) ./files/style.css $(1)/www/moci/js/addons/docker/style.css
	$(INSTALL_DIR) $(1)/usr/libexec/rpcd
	$(INSTALL_BIN) ./files/rpcd-moci-docker $(1)/usr/libexec/rpcd/moci-docker
	$(INSTALL_DIR) $(1)/usr/libexec
	$(INSTALL_BIN) ./files/moci-docker-api $(1)/usr/libexec/moci-docker-api
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./files/moci-docker-policy $(1)/usr/sbin/moci-docker-policy
	$(INSTALL_BIN) ./files/moci-docker-firewall $(1)/usr/sbin/moci-docker-firewall
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/init-moci-docker-firewall $(1)/etc/init.d/moci-docker-firewall
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./files/acl.json $(1)/usr/share/rpcd/acl.d/moci-app-docker.json
	$(INSTALL_DIR) $(1)/etc/moci-docker
	$(INSTALL_CONF) ./files/app-catalog.json $(1)/etc/moci-docker/app-catalog.json
	$(INSTALL_CONF) ./files/app-templates.json $(1)/etc/moci-docker/app-templates.json
	$(INSTALL_CONF) ./files/allowed-images.json $(1)/etc/moci-docker/allowed-images.json
	$(INSTALL_CONF) ./files/app-pins.json $(1)/etc/moci-docker/app-pins.json
endef

define Package/moci-app-docker/postinst
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
    /etc/init.d/moci-docker-firewall enable 2>/dev/null || :
    /etc/init.d/moci-docker-firewall restart 2>/dev/null || :
}
endef

$(eval $(call BuildPackage,moci-app-docker))
