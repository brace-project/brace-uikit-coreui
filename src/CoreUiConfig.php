<?php


namespace Brace\UiKit\CoreUi;




use Brace\UiKit\Base\Element\NavBar;
use Brace\UiKit\Base\UiBaseConfig;

class CoreUiConfig extends UiBaseConfig
{



    public $brandLogoUrl;

    public $brandName = "BrandName";


    /**
     * @var NavBar
     */
    public $topNav;

    /**
     * @var NavBar
     */
    public $topRightNav;

    /**
     * @var NavBar
     */
    public $sideNav;

    public $avatarName = "";
    public $avatarSrc = null;

    /**
     * @var NavBar
     */
    public $accountPopup;

    /**
     * @var NavBar
     */
    public $breadcrumb;

    public $plugins = [
        "chartjs" => false
    ];

    public $footer = [
        "div" => ["a @href=https://coreui.io" => "CoreUI Theme"],
        "div @ml-auto" => ["a @href=https://infracamp.org" => "brace/uikit-coreui"]
    ];

    public function __construct (string $assetRoot = "/assets/")
    {
        $this->sideNav = new NavBar();
        $this->topNav = new NavBar();
        $this->topRightNav = new NavBar();
        $this->breadcrumb = new NavBar();

        $this->accountPopup = new NavBar();

        $this->brandLogoUrl = $assetRoot . "brand-logo.png";
        $this->jsLinkFooter[] = $assetRoot . "js/ui-bundle.js";
        $this->jsLinkFooter[] = $assetRoot . "js/plugins.js";
        $this->cssLinkHead[] = $assetRoot . "css/ui-bundle.css";
        $this->cssLinkHead[] = $assetRoot . "css/plugins.css";
    }


}