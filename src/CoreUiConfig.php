<?php


namespace Brace\UiKit\CoreUi;


class CoreUiConfig
{



    public $lang = "en";
    public $title = "Brace CoreUI :: Unnamed Application";

    public $meta = [
        "charset" => "utf-8",
        "viewport" => "width=device-width, initial-scale=1.0, shrink-to-fit=no",
        "X-UA-Compatible" => "IE=edge",
        "description" => "",
        "author" => "",
        "keyword" => ""
    ];


    public $jsLinkHead = [];
    public $jsLinkFooter = [];
    public $cssLinkHead = [];


    public $brandLogoUrl;

    public $brandName = "BrandName";


    /**
     * @var NavBar
     */
    public $topNav = [];

    /**
     * @var NavBar
     */
    public $sideNav;

    /**
     * @var NavBar
     */
    public $accountPopup = [];

    public function __construct (string $assetRoot = "/assets/")
    {
        $this->sideNav = new NavBar();
        $this->topNav = new NavBar();
        $this->accountPopup = new NavBar();

        $this->brandLogoUrl = $assetRoot . "brand-logo.png";
        $this->jsLinkFooter[] = $assetRoot . "js/ui-bundle.js";
        $this->cssLinkHead[] = $assetRoot . "css/ui-bundle.css";
    }


}