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
     * @var Button[]
     */
    public $topNav = [];

    /**
     * @var Button[]
     */
    public $leftNav = [];

    /**
     * @var Button[]
     */
    public $accountPopup = [];

    public function __construct (string $assetRoot = "/assets/")
    {
        $this->brandLogoUrl = $assetRoot . "brand-logo.png";
        $this->jsLinkFooter[] = $assetRoot . "ui-bundle.js";
        $this->cssLinkHead[] = $assetRoot . "ui-bundle.css";
    }


}