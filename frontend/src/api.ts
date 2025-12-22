const API = import.meta.env.VITE_API_BASE_URL;

export async function getHealth() {
    const res = await fetch(`${API}/health`);
    return res.json();
}

export async function getPlayCount() {
    const res = await fetch(`${API}/api/plays/count`)
    return res.json();
}