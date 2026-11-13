include $(TOPDIR)/rules.mk

PKG_NAME:=moci
PKG_VERSION:=0.11.1
PKG_RELEASE:=2

PKG_MAINTAINER:=HudsonGraeme
PKG_LICENSE:=MIT
PKG_LICENSE_FILES:=LICENSE

include $(INCLUDE_DIR)/package.mk

define Package/moci
  SECTION:=admin
  CATEGORY:=Administration
  TITLE:=MoCI - Modern Configuration Interface for OpenWrt
  PKGARCH:=all
  DEPENDS:=+rpcd +jsonfilter +uhttpd +uhttpd-mod-ubus
endef

define Package/moci/description
  Modern web interface for OpenWrt routers.
  Pure vanilla JavaScript SPA using OpenWrt's native ubus API.
  Works with uhttpd (standard OpenWrt) or lighttpd (TurrisOS).
endef

define Build/Compile
endef

define Package/moci/install
	$(INSTALL_DIR) $(1)/www/moci
	$(INSTALL_DATA) ./dist/moci/index.html $(1)/www/moci/
	$(INSTALL_DATA) ./dist/moci/app.css $(1)/www/moci/
	$(INSTALL_DATA) ./dist/moci/manifest.json $(1)/www/moci/

	$(INSTALL_DIR) $(1)/www/moci/icons
	$(INSTALL_DATA) ./dist/moci/icons/icon-192.png $(1)/www/moci/icons/
	$(INSTALL_DATA) ./dist/moci/icons/icon-512.png $(1)/www/moci/icons/

	$(INSTALL_DIR) $(1)/www/moci/js
	$(INSTALL_DATA) ./dist/moci/js/core.js $(1)/www/moci/js/

	$(INSTALL_DIR) $(1)/www/moci/js/modules
	$(INSTALL_DATA) ./dist/moci/js/modules/dashboard.js $(1)/www/moci/js/modules/
	$(INSTALL_DATA) ./dist/moci/js/modules/network.js $(1)/www/moci/js/modules/
	$(INSTALL_DATA) ./dist/moci/js/modules/upnp.js $(1)/www/moci/js/modules/
	$(INSTALL_DATA) ./dist/moci/js/modules/system.js $(1)/www/moci/js/modules/
	$(INSTALL_DATA) ./dist/moci/js/modules/addons.js $(1)/www/moci/js/modules/
	$(INSTALL_DATA) ./dist/moci/js/modules/advanced.js $(1)/www/moci/js/modules/
	$(INSTALL_DATA) ./dist/moci/js/modules/profiles.js $(1)/www/moci/js/modules/
	$(INSTALL_DATA) ./dist/moci/js/modules/wifi-schedules.js $(1)/www/moci/js/modules/
	$(INSTALL_DATA) ./dist/moci/js/modules/wifi-profiles.js $(1)/www/moci/js/modules/
	$(INSTALL_DATA) ./dist/moci/js/modules/vpn-policies.js $(1)/www/moci/js/modules/
	$(INSTALL_DATA) ./dist/moci/js/modules/ethernet-profiles.js $(1)/www/moci/js/modules/

	$(INSTALL_DIR) $(1)/www/moci/js/addons

	$(INSTALL_DIR) $(1)/usr/libexec
	$(INSTALL_BIN) ./files/moci-pkg-call $(1)/usr/libexec/moci-pkg-call
	$(INSTALL_BIN) ./files/moci-service-inspect $(1)/usr/libexec/moci-service-inspect
	$(INSTALL_BIN) ./files/moci-hardware-check $(1)/usr/libexec/moci-hardware-check
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./files/moci-wifi-scheduler $(1)/usr/sbin/moci-wifi-scheduler
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/init-moci-wifi-scheduler $(1)/etc/init.d/moci-wifi-scheduler

	$(INSTALL_DIR) $(1)/usr/libexec/rpcd
	$(INSTALL_BIN) ./files/rpcd-moci $(1)/usr/libexec/rpcd/moci

	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./rpcd-acl.json $(1)/usr/share/rpcd/acl.d/moci.json

	$(INSTALL_DIR) $(1)/usr/share/acl.d
	$(INSTALL_DATA) ./files/ubus-acl-moci.json $(1)/usr/share/acl.d/moci.json

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/moci.config $(1)/etc/config/moci
	$(INSTALL_CONF) ./files/moci-wifi-schedule.config $(1)/etc/config/moci_wifi_schedule

	$(INSTALL_DIR) $(1)/etc/opkg/keys
	$(INSTALL_DATA) ./files/moci-feed.pub $(1)/etc/opkg/keys/bc0c5f67deb5edb8
	$(INSTALL_CONF) ./files/moci-apps.conf $(1)/etc/opkg/moci-apps.conf

	$(INSTALL_BIN) ./files/ubus.cgi $(1)/www/moci/ubus.cgi

	$(INSTALL_DIR) $(1)/etc/lighttpd/conf.d
	$(INSTALL_DATA) ./files/lighttpd-moci.conf $(1)/etc/lighttpd/conf.d/50-moci.conf
endef

define Package/moci/conffiles
/etc/config/moci
/etc/config/moci_wifi_schedule
/etc/opkg/moci-apps.conf
endef

define Package/moci/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	kill -HUP $$(pidof ubusd) 2>/dev/null
	/etc/init.d/rpcd restart
	/etc/init.d/moci-wifi-scheduler enable 2>/dev/null || :
	/etc/init.d/moci-wifi-scheduler start 2>/dev/null || :
	if [ -f /etc/init.d/lighttpd ]; then
		/etc/init.d/lighttpd restart
		echo "MoCI installed (lighttpd). Access at http://[router-ip]/moci/"
	else
		echo "MoCI installed. Access at http://[router-ip]/moci/"
	fi
}
endef

$(eval $(call BuildPackage,moci))
