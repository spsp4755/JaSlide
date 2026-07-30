import {
    Link as ReactRouterLink,
    useLocation,
    useNavigate,
    useParams as useReactParams,
    useSearchParams as useReactSearchParams,
    type LinkProps as ReactRouterLinkProps,
    type To,
} from 'react-router-dom';
import { forwardRef, useMemo } from 'react';

type LinkProps = Omit<ReactRouterLinkProps, 'to'> & { href: To };

const Link = forwardRef<HTMLAnchorElement, LinkProps>(({ href, ...props }, ref) => (
    <ReactRouterLink ref={ref} to={href} {...props} />
));
Link.displayName = 'Link';

export function useRouter() {
    const navigate = useNavigate();
    return useMemo(
        () => ({
            push: (href: To) => navigate(href),
            replace: (href: To) => navigate(href, { replace: true }),
            back: () => navigate(-1),
            refresh: () => window.location.reload(),
        }),
        [navigate]
    );
}

export const usePathname = () => useLocation().pathname;
export const useParams = useReactParams;
export const useSearchParams = () => useReactSearchParams()[0];

export default Link;
