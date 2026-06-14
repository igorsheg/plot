export const redirect = (href: string): never => {
	if (typeof window !== "undefined") window.location.replace(href);
	throw new Error(`redirect: ${href}`);
};

export const permanentRedirect = redirect;

export const useRouter = () => ({
	push: (href: string) => {
		window.location.assign(href);
	},
	replace: (href: string) => {
		window.location.replace(href);
	},
});
