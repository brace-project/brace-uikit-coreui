<?php

namespace Brace\UiKit\CoreUi;
use Brace\UiKit\CoreUi\Element\Button;
use Brace\UiKit\CoreUi\Element\Spacer;
use Brace\UiKit\CoreUi\Element\Title;
use Brace\UiKit\CoreUi\Template\Renderer;

/**
 * @var \Brace\UiKit\CoreUi\CoreUiConfig $__CONFIG
 * @var Renderer $this
 * @var string $__CONTENT
 */

$this->renderIn(__DIR__ . "/base.tpl.php");

?>


<div class="c-sidebar c-sidebar-dark c-sidebar-fixed c-sidebar-lg-show" id="sidebar">
    <div class="c-sidebar-brand d-lg-down-none">
        <a class="c-sidebar-brand-full" width="118" height="46">
            <img src="<?php txt($__CONFIG->brandLogoUrl) ?>" height="46">
            <span><?php txt($__CONFIG->brandName)?></span>
        </a>
        <a class="c-sidebar-brand-minimized" width="46" height="46" alt="CoreUI Logo">
            <img src="<?php txt($__CONFIG->brandLogoUrl) ?>" height="46">
        </a>
    </div>
    <?php

    $nav = $__CONFIG->sideNav;

    $nav->setRenderer(function (Button $b) {
        $childList = null;
        if (count($b->childreen) > 0) {
            $childList = fhtml("ul @class=c-sidebar-nav-dropdown-items");
            foreach ($b->childreen as $child) {
                $childList[] = fhtml([
                        "li @class=c-sidebar-nav-item" => [
                                "a @class=c-sidebar-nav-link @href=:href" => [
                                    "span @class=c-sidebar-nav-icon @class=:icon" => "",
                                    "{$child->name}",
                                    $child->badge
                                ]
                        ]
                ], (array)$child);
            }

            return fhtml(
                ["li @class=c-sidebar-nav-dropdown" => [
                    "a @class=c-sidebar-nav-dropdown-toggle @href=:href" => [
                        ["i @class=c-sidebar-nav-icon @class=:icon" => ""],
                        "$b->name",
                        $b->badge
                    ],
                    $childList
                ]
                ], (array)$b);
        }

        return fhtml(
            ["li @class=c-sidebar-nav-item" => [
                "a @class=c-sidebar-nav-link @href=:href" => [
                    ["i @class=c-sidebar-nav-icon @class=:icon" => ""],
                    "$b->name",
                    $b->badge
                ],
                $childList
            ]
            ], (array)$b);
    });

    $nav->out("ul @class=c-sidebar-nav");

    ?>
    <button class="c-sidebar-minimizer c-class-toggler" type="button" data-target="_parent" data-class="c-sidebar-minimized"></button>
</div>
<div class="c-wrapper c-fixed-components">
    <header class="c-header c-header-light c-header-fixed c-header-with-subheader">
        <button class="c-header-toggler c-class-toggler d-lg-none mfe-auto" type="button" data-target="#sidebar" data-class="c-sidebar-show">
            <i class="c-icon c-icon-lg cil-menu"></i>
        </button>
        <button class="c-header-toggler c-class-toggler mfs-3 d-md-down-none" type="button" data-target="#sidebar" data-class="c-sidebar-lg-show" responsive="true">
            <i class="c-icon c-icon-lg cil-menu"></i>
        </button>
        <?php

        $nav = $__CONFIG->topNav;
        $nav->setRenderer(function (Button $b) {
            return fhtml([
                    "li @c-header-nav-item @px-3" => [
                            "a @c-header-nav-link @href=:href" => $b->name
                    ]
            ], (array)$b);
        });

        $nav->out("ul @class=c-header-nav  @class=d-md-down-none");





        ?>
        <ul class="c-header-nav ml-auto mr-4">
            <?php

            $nav = $__CONFIG->topRightNav;

            $nav->setRenderer(function (Button $button) {
                $e = fhtml(
                        ["li @c-header-nav-item @d-md-down-none mx-2" => [
                                "a @c-header-nav-link @href=:href" => [
                                        "i @font-2xl @class=:icon" => ""
                                ]
                            ]
                        ], (array)$button);
                return $e;
            });

            $nav->out("");
            ?>



            <li class="c-header-nav-item dropdown">
                <a class="c-header-nav-link " data-toggle="dropdown" href="#" role="button" aria-haspopup="true" aria-expanded="false">
                    <div class="c-avatar">
                        <?php

                        if ($__CONFIG->avatarSrc !== null) {
                            echo fhtml("img @c-avatar-img @src=? @alt=?", [$__CONFIG->avatarSrc, $__CONFIG->avatarName]);
                        } else {
                            echo fhtml("i @c-avatar-img @font-2xl @bi @bi-person-circle @alt=?", [$__CONFIG->avatarName]);
                        }

                        ?>

                    </div>
                </a>

                <?php

                $nav = $__CONFIG->accountPopup;

                $nav->setRenderer(function (Button $button) {
                    if ($button instanceof Title) {
                        return fhtml(["div @dropdown-header bg-light py-2" => [
                            "strong" => $button->name
                        ]]);
                    }
                    if ($button instanceof Spacer) {
                        return fhtml("div @dropdown-divider");
                    }
                    return fhtml([
                            "a @dropdown-item @href=:href" => [
                                    "i @c-icon @mr-2 @class=:icon" => "",
                                    "$button->name"
                            ]
                    ], (array)$button);
                });
                $nav->out("div @dropdown-menu @dropdown-menu-right @pt-0");

                ?>
            </li>
        </ul>
        <?php

        $nav = $__CONFIG->breadcrumb;

        if ($nav->count() > 0):

        ?>
        <div class="c-subheader px-3">
            <?php
            $nav->setRenderer(function (Button  $button) {
                if ($button->href !== "") {
                    return fhtml([
                        "li @breadcrumb-item" => [
                                "a @href=:href" => $button->name
                        ]
                    ], (array)$button);
                }
                return fhtml(["li @breadcrumb-item" => $button->name]);
            });
            $nav->out("ol @breadcrumb @border-0 @m-0");
            ?>
        </div>
        <?php endif; ?>
    </header>
    <div class="c-body">
        <main class="c-main">
            <?php echo $__CONTENT ?>
        </main>
        <?php

        if ($__CONFIG->footer !== null) {
            el(["footer @c-footer" => $__CONFIG->footer]);
        }

        ?>
    </div>

</div>



